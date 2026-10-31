export declare const ARGON2_PARAMS: Readonly<{
  memoryCost: 19456;
  timeCost: 2;
  parallelism: 1;
}>;
export declare const MAX_PASSWORD_LENGTH: 256;
export declare function hashPassword(plain: string): Promise<string>;
export declare function verifyPassword(storedHash: string, plain: string): Promise<boolean>;
