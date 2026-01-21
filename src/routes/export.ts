import { Router } from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";
import type { ExportRequest } from "../types.js";

const router = Router();

// POST /export – returns a valid PDF or XLSX file.
router.post("/", async (req, res) => {
  const body = req.body as ExportRequest;
  const type = body?.type === "xlsx" ? "xlsx" : "pdf";

  try {
    if (type === "pdf") {
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const font = await doc.embedFont(StandardFonts.Helvetica);

      page.drawText("Forecast Report", {
        x: 50,
        y: 720,
        size: 20,
        font,
        color: rgb(0, 0, 0),
      });
      page.drawText("This is a mock export. Replace with real forecast/explain data when wired to the backend.", {
        x: 50,
        y: 680,
        size: 12,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
      page.drawText(`Run ID: ${body?.runId ?? "—"}  |  Scenario: ${body?.scenarioRunId ?? "—"}`, {
        x: 50,
        y: 640,
        size: 10,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });

      const pdfBytes = await doc.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="forecast-report.pdf"');
      res.send(Buffer.from(pdfBytes));
      return;
    }

    // XLSX: real Excel file via exceljs
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Forecast");
    sheet.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Actual", key: "actual", width: 10 },
      { header: "Forecast", key: "forecast", width: 10 },
    ];
    sheet.addRows([
      { date: "2025-01-01", actual: 100, forecast: 102 },
      { date: "2025-01-02", actual: 105, forecast: 104 },
      { date: "2025-01-03", actual: 110, forecast: 108 },
      { date: "2025-01-04", actual: 108, forecast: 111 },
      { date: "2025-01-05", actual: 115, forecast: 114 },
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="forecast-export.xlsx"');
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
