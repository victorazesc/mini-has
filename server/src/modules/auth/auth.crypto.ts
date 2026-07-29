import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_SCHEME = 'scrypt';
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY,
  });

  return [
    PASSWORD_SCHEME,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue] =
    encoded.split('$');

  if (
    scheme !== PASSWORD_SCHEME ||
    !costValue ||
    !blockSizeValue ||
    !parallelizationValue ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const cost = Number(costValue);
  const blockSize = Number(blockSizeValue);
  const parallelization = Number(parallelizationValue);
  if (
    !Number.isInteger(cost) ||
    cost < 16_384 ||
    cost > 1_048_576 ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > 32 ||
    !Number.isInteger(parallelization) ||
    parallelization < 1 ||
    parallelization > 16
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(hashValue, 'base64url');
    if (salt.length < 16 || expected.length !== PASSWORD_KEY_LENGTH) return false;

    const actual = await scrypt(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: Math.max(SCRYPT_MAX_MEMORY, 128 * cost * blockSize + 1024 * 1024),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function isValidPkceVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
