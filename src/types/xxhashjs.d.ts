declare module "xxhashjs" {
  interface XXHashDigest {
    toString(radix?: number): string;
  }

  interface XXHash64State {
    update(input: string | Buffer | Uint8Array): XXHash64State;
    digest(): XXHashDigest;
  }

  interface XXHashStatic {
    h64(seed: number): XXHash64State;
    h64(input: string | Buffer | Uint8Array, seed: number): XXHashDigest;
  }

  const XXH: XXHashStatic;
  export default XXH;
}
