# Pricing

Exact fixed-point calculators shared by Work Orders, Purchasing, Invoicing and
TJX. Money rules and fixtures live here; module servers never re-implement them.

## Parity notes

- PO special parts compare the scaled quantity to `-99999`, so `-9999.99` is included (N1).
- Quote `numTechs` follows PHP `empty()`: null, `''`, `0` and `'0'` mean one tech; `'0.00'` stays zero (N4).
- The MB July-2019 boundary compares the full timestamp, so `2019-06-30 23:59:59` is 12% (N6).
- TJX without-markup lines price the raw accumulated quantity; the 3-decimal value is display only (N7).
- Unknown non-blank sales provinces still default to ON 13%; invoice and TJX save log the fallback (S4).
