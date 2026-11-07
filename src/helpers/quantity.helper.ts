export type QuantityUnit = {
    unitName: string;
    baseRatio: number | string;
};

export function decomposeQuantity(
    baseQty: number,
    units: QuantityUnit[],
): string {
    const isNegative = baseQty < 0;
    const absQty = Math.abs(baseQty);
    let remaining = absQty;
    const decomposed: string[] = [];

    for (const unit of units) {
        const unitRatio = Number(unit.baseRatio);
        if (unitRatio <= 0) continue;

        const count = Math.floor(remaining / unitRatio + 0.0001);
        if (count > 0) {
            decomposed.push(`${count} ${unit.unitName}`);
            remaining = Number((remaining % unitRatio).toFixed(4));
        }
    }

    if (decomposed.length === 0 && absQty > 0 && units.length > 0) {
        const smallestUnit = units[units.length - 1];
        const smallestRatio = Number(smallestUnit.baseRatio);
        if (smallestRatio > 0) {
            const count = absQty / smallestRatio;
            const displayCount =
                count < 1 && count % 1 !== 0
                    ? Number(count.toFixed(2))
                    : count.toFixed(0);
            if (Number(displayCount) > 0) {
                decomposed.push(`${displayCount} ${smallestUnit.unitName}`);
            }
        }
    }

    const formatted = decomposed.join(" ");
    return isNegative && formatted ? `-${formatted}` : formatted;
}
