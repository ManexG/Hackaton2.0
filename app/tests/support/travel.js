export async function openField(page, field) {
  if (!(await page.locator(`#${field}`).isVisible()))
    await page.locator(`.field-summary[aria-controls="${field}-editor"]`).click();
}
