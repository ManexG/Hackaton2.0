export async function openField(page, field) {
  if (!(await page.locator('.sidebar').isVisible())) await openSection(page, 'Buscar viaje');
  if (await page.locator(`#${field}`).isVisible()) return;
  const summary = page.locator(`.field-summary[aria-controls="${field}-editor"]`);
  // Only one step is shown at a time: switch with the step navigation or the summary card.
  if (await summary.isVisible()) await summary.click();
  else await page.locator('.step-nav button').click();
}

// The map fills the screen; sections open as a bottom sheet from the bottom navigation.
export async function openSection(page, name) {
  const nav = page.locator('.bottom-nav').getByRole('button', { name, exact: true });
  if ((await nav.getAttribute('aria-pressed')) !== 'true') await nav.click();
  await page.locator('.sidebar').waitFor({ state: 'visible' });
}
export async function openCommunity(page) {
  if (!(await page.locator('.sidebar').isVisible())) await openSection(page, 'Buscar viaje');
  await page.getByRole('button', { name: 'Comunidad', exact: true }).click();
}
