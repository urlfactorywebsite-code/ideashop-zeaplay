export async function pickDate(page, field, date, dialogLabel = 'Choose due date') {
  await field.click();
  const calendar = page.getByRole('dialog', { name: dialogLabel, exact: true });
  await calendar.waitFor({ state: 'visible' });
  const day = calendar.locator(`[data-day="${date}"]:not([data-outside]) button`);
  for (let attempt = 0; !(await day.count()) && attempt < 24; attempt++) {
    const first = await calendar.locator('[data-day]:not([data-outside])').first().getAttribute('data-day');
    await calendar.getByRole('button', { name: date < first ? 'Go to the Previous Month' : 'Go to the Next Month', exact: true }).click();
  }
  await day.click();
  await calendar.waitFor({ state: 'hidden' });
}

export const pickSubtaskDate = (page, field, date) => pickDate(page, field, date, 'Choose subtask due date');

export async function pickTime(page, field, time) {
  await field.click();
  const picker = page.getByRole('dialog', { name: 'Choose due time', exact: true });
  const [hours, minutes] = time.split(':');
  await picker.getByLabel('Hours', { exact: true }).fill(hours);
  await picker.getByLabel('Minutes', { exact: true }).fill(minutes);
  await picker.getByRole('button', { name: 'Apply time', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
}
