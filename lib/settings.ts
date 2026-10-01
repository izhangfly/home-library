import { prisma } from "./prisma";
import { DEFAULT_COEFFICIENTS, type CapacityCoefficients } from "./capacity";

const COEFF_KEY = "capacity.coefficients";

export async function getCoefficients(): Promise<CapacityCoefficients> {
  const row = await prisma.setting.findUnique({ where: { key: COEFF_KEY } });
  if (!row) return DEFAULT_COEFFICIENTS;
  // 只覆盖存在的字段，将来加新系数时老数据不会炸
  return { ...DEFAULT_COEFFICIENTS, ...(row.value as Partial<CapacityCoefficients>) };
}

export async function saveCoefficients(
  partial: Partial<CapacityCoefficients>,
): Promise<CapacityCoefficients> {
  const merged = { ...(await getCoefficients()), ...partial };
  await prisma.setting.upsert({
    where: { key: COEFF_KEY },
    create: { key: COEFF_KEY, value: merged },
    update: { value: merged },
  });
  return merged;
}
