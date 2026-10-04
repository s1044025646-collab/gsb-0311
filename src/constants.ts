// 固定公布的物理常数与常量版本号。修改常数必须提升版本号，
// 数据库中冻结每次分析所用的版本，便于追溯。
export const R = 8.31446261815324; // J/(mol*K)，CODATA 精确值
export const CONSTANTS_VERSION = "codata-2018-R-exact-v1";

export interface Limits {
  maxSegments: number;
  maxSamples: number;
  maxAmount: number; // mol
  maxTemperature: number; // K
  maxVolume: number; // m^3
}

export const DEFAULT_LIMITS: Limits = {
  maxSegments: 64,
  maxSamples: 200,
  maxAmount: 1e6,
  maxTemperature: 1e6,
  maxVolume: 1e9,
};
