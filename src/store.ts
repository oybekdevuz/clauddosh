import { Redis } from "ioredis";
import { config } from "./config.js";

const P = "cd:"; // barcha kalitlar prefiksi

const K = {
  users: `${P}users`, // SET: botga start bosgan hamma
  user: (id: number | string) => `${P}user:${id}`, // HASH: profil
  queue: (size: number | string) => `${P}queue:${size}`, // LIST: shu o'lchamdagi guruh navbati
  inQueue: `${P}inqueue`, // HASH: userId -> guruh o'lchami
  groupsTotal: `${P}stats:groups`,
  groupsBySize: `${P}stats:groups_by_size`, // HASH: size -> count
  matchedPeople: `${P}stats:matched_people`,
  day: (d: string) => `${P}stats:day:${d}`, // HASH: groups, people
  groups: `${P}groups`, // LIST: oxirgi guruhlar (JSON)
};

export interface UserProfile {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
}

export type JoinResult =
  | { status: "already"; size: number }
  | { status: "waiting"; size: number; count: number }
  | { status: "matched"; size: number; memberIds: number[] };

/**
 * Navbatga qo'shish va guruh to'lsa shu zahoti ajratib olish — bitta atomar Lua skriptda,
 * shuning uchun bir vaqtda bosgan odamlar ikki guruhga tushib qolmaydi.
 * KEYS[1]=queue, KEYS[2]=inqueue  ARGV[1]=userId, ARGV[2]=size
 */
const JOIN_LUA = `
local cur = redis.call('HGET', KEYS[2], ARGV[1])
if cur then return {-1, cur} end
redis.call('RPUSH', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
local n = tonumber(ARGV[2])
local len = redis.call('LLEN', KEYS[1])
if len >= n then
  local ids = redis.call('LRANGE', KEYS[1], 0, n - 1)
  redis.call('LTRIM', KEYS[1], n, -1)
  for _, id in ipairs(ids) do redis.call('HDEL', KEYS[2], id) end
  return {1, ids}
end
return {0, len}
`;

/** KEYS[1]=inqueue  ARGV[1]=userId, ARGV[2]=queue prefix */
const LEAVE_LUA = `
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if not cur then return 0 end
redis.call('LREM', ARGV[2] .. cur, 0, ARGV[1])
redis.call('HDEL', KEYS[1], ARGV[1])
return tonumber(cur)
`;

type Cmds = {
  cdJoin(queue: string, inQueue: string, userId: string, size: string): Promise<[number, unknown]>;
  cdLeave(inQueue: string, userId: string, queuePrefix: string): Promise<number>;
};

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 }) as Redis & Cmds;
redis.defineCommand("cdJoin", { numberOfKeys: 2, lua: JOIN_LUA });
redis.defineCommand("cdLeave", { numberOfKeys: 1, lua: LEAVE_LUA });

const today = () => new Date().toISOString().slice(0, 10);

export async function saveUser(u: UserProfile): Promise<void> {
  const fields: Record<string, string> = {
    firstName: u.firstName,
    lastName: u.lastName ?? "",
    username: u.username ?? "",
    updatedAt: String(Date.now()),
  };
  await redis
    .multi()
    .sadd(K.users, String(u.id))
    .hset(K.user(u.id), fields)
    .hsetnx(K.user(u.id), "joinedAt", String(Date.now()))
    .exec();
}

export async function getUsers(ids: number[]): Promise<UserProfile[]> {
  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.hgetall(K.user(id)));
  const res = (await pipe.exec()) ?? [];
  return ids.map((id, i) => {
    const h = (res[i]?.[1] ?? {}) as Record<string, string>;
    return {
      id,
      firstName: h.firstName || "Foydalanuvchi",
      lastName: h.lastName || undefined,
      username: h.username || undefined,
    };
  });
}

export async function joinQueue(userId: number, size: number): Promise<JoinResult> {
  const [code, payload] = await redis.cdJoin(K.queue(size), K.inQueue, String(userId), String(size));
  if (code === -1) return { status: "already", size: Number(payload) };
  if (code === 0) return { status: "waiting", size, count: Number(payload) };

  const memberIds = (payload as string[]).map(Number);
  const d = today();
  await redis
    .multi()
    .incr(K.groupsTotal)
    .hincrby(K.groupsBySize, String(size), 1)
    .incrby(K.matchedPeople, memberIds.length)
    .hincrby(K.day(d), "groups", 1)
    .hincrby(K.day(d), "people", memberIds.length)
    .expire(K.day(d), 60 * 60 * 24 * 90)
    .lpush(K.groups, JSON.stringify({ size, memberIds, at: Date.now() }))
    .ltrim(K.groups, 0, 999)
    .exec();
  return { status: "matched", size, memberIds };
}

/** Navbatdan chiqaradi. Qaytaradi: qaysi guruh o'lchamidan chiqdi yoki null. */
export async function leaveQueue(userId: number): Promise<number | null> {
  const size = await redis.cdLeave(K.inQueue, String(userId), `${P}queue:`);
  return size ? Number(size) : null;
}

export async function getQueueState(
  userId: number,
): Promise<{ size: number; position: number; count: number } | null> {
  const sizeStr = await redis.hget(K.inQueue, String(userId));
  if (!sizeStr) return null;
  const size = Number(sizeStr);
  const list = await redis.lrange(K.queue(size), 0, -1);
  const idx = list.indexOf(String(userId));
  return { size, position: idx + 1, count: list.length };
}

export async function getStats(sizes: number[]) {
  const d = today();
  const pipe = redis
    .pipeline()
    .scard(K.users)
    .get(K.groupsTotal)
    .get(K.matchedPeople)
    .hgetall(K.groupsBySize)
    .hgetall(K.day(d));
  sizes.forEach((s) => pipe.llen(K.queue(s)));
  const r = ((await pipe.exec()) ?? []).map((x) => x[1]);

  return {
    users: Number(r[0] ?? 0),
    groupsTotal: Number(r[1] ?? 0),
    matchedPeople: Number(r[2] ?? 0),
    groupsBySize: (r[3] ?? {}) as Record<string, string>,
    today: (r[4] ?? {}) as Record<string, string>,
    queues: sizes.map((s, i) => ({ size: s, waiting: Number(r[5 + i] ?? 0) })),
  };
}
