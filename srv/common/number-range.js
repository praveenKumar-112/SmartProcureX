import cds from '@sap/cds';

const { SELECT, INSERT, UPDATE } = cds.ql;

export async function generateBusinessNumber(tx, objectType) {

    const year = new Date().getFullYear();

    const { NumberRanges } = cds.entities('smartprocurex.common');

    let range = await tx.run(
        SELECT.one.from(NumberRanges).where({
            objectType,
            year
        })
    );

    if (!range) {

        range = {
            objectType,
            year,
            currentNumber: 0
        };

        await tx.run(
            INSERT.into(NumberRanges).entries(range)
        );

    }

    const nextNumber = range.currentNumber + 1;

    await tx.run(
        UPDATE(NumberRanges)
            .set({
                currentNumber: nextNumber
            })
            .where({
                objectType,
                year
            })
    );

    return `${objectType}-${year}-${String(nextNumber).padStart(6, '0')}`;
}