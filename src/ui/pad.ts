/** The custom 1-9 number pad plus erase, shared by every editable board. */
export function createNumberPad(onDigit: (digit: number) => void): HTMLDivElement {
  const pad = document.createElement("div");
  pad.className = "pad";
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Number pad");
  for (let d = 0; d <= 9; d++) {
    const b = document.createElement("button");
    b.type = "button";
    // Erase goes last, after 9, as in the mockups.
    const digit = d === 9 ? 0 : d + 1;
    b.textContent = digit ? String(digit) : "×";
    b.dataset.digit = String(digit);
    b.setAttribute("aria-label", digit ? `Enter ${digit}` : "Erase");
    pad.appendChild(b);
  }
  pad.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button[data-digit]");
    if (t) onDigit(Number(t.dataset.digit));
  });
  return pad;
}
