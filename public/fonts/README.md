# Custom fonts for PDF generation

The redesigned proforma/quotation PDF (`components/QuotationPDF.tsx`)
uses the two commercial typefaces from the SOLUX brand pack:

- **Armin Grotesk** (Lineto) — body text, header info, table content
- **Akzidenz-Grotesk Light Extended** (Berthold) — document title +
  footer section headers

These are paid fonts. The repo doesn't ship the font files in version
control; they're loaded from this directory at PDF generation time.
If a file is missing, `@react-pdf/renderer` falls back to Helvetica
silently — the PDF still generates, just looks plainer.

## Files currently expected

These are the exact filenames `lib/pdfFonts.ts` looks for. If you swap
to different OTF/TTF variants, update both this README and that file.

```
public/fonts/
├── ArminGrotesk-Thin.otf
├── ArminGrotesk-UltraLight.otf
├── ArminGrotesk-Regular.otf
├── ArminGrotesk-SemiBold.otf
└── AkzidenzGrotesk-LightExtended.otf
```

Weight mapping in `lib/pdfFonts.ts`:

| File                                   | family            | fontWeight |
|----------------------------------------|-------------------|------------|
| ArminGrotesk-Thin.otf                  | Armin Grotesk     | 100        |
| ArminGrotesk-UltraLight.otf            | Armin Grotesk     | 200        |
| ArminGrotesk-Regular.otf               | Armin Grotesk     | 400        |
| ArminGrotesk-SemiBold.otf              | Armin Grotesk     | 600        |
| AkzidenzGrotesk-LightExtended.otf      | Akzidenz Extended | 300        |

## TTF vs OTF

`@react-pdf/renderer` uses **fontkit** under the hood. Both OTF and TTF
work; we're standardised on OTF here because that's what the brand pack
ships with.

## How to verify the fonts are loaded

After dropping new files, regenerate any PDF (e.g. open a quotation,
click "Generate PDF"). The body text should look like the designer's
reference (geometric grotesque, not Helvetica's softer humanist shapes).

If the title still looks Helvetica-y, check:
- Filenames match exactly (case-sensitive on Linux/macOS Docker hosts).
- Files are valid OTF/TTF (not renamed/corrupt).
- Hard-refresh the browser cache (Cmd-Shift-R).
- Restart `npm run dev` once after dropping new files so Next.js
  re-reads the `public/` static tree.

## Licensing

`@react-pdf/renderer` embeds the fonts in the generated PDF. Make sure
the license you bought covers embedded distribution in delivered
documents (most commercial licenses do, but verify if you're publishing
the PDFs publicly).
