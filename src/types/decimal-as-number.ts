import { customType } from "drizzle-orm/pg-core";

export const decimalAsNumber = (precision: number, scale: number) =>
    customType<{
        data: number;
        driverData: string;
    }>({
        dataType: () => `numeric(${precision},${scale})`,
        fromDriver: (value) => Number(value),
        toDriver: (value) => value.toString(),
    });
