// @vitest-environment node
import { it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { validateTicket } from "@/features/smart-bills/files";
it("validates actual JPG, PNG and WEBP signatures and dimensions",async()=>{for(const format of ["png","jpeg","webp"] as const){const bytes=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).toFormat(format).toBuffer();const result=await validateTicket(new File([new Uint8Array(bytes)],`ticket.${format}`,{type:`image/${format}`}));expect(result.mime).toBe(`image/${format}`);expect(result.pages).toBe(1);}});
it("rejects spoofed, empty, corrupt and oversized files",async()=>{for(const file of [new File(["not a PDF"],"ticket.pdf",{type:"application/pdf"}),new File([],"empty.png",{type:"image/png"}),new File([new Uint8Array(2097153)],"huge.png",{type:"image/png"})])await expect(validateTicket(file)).rejects.toThrow();const bytes=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();await expect(validateTicket(new File([new Uint8Array(bytes)],"fake.jpg",{type:"image/jpeg"}))).rejects.toThrow(/coincide/);});
it("accepts up to three real PDF pages, rejects four and damaged PDF",async()=>{const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();pdf.addPage();expect((await validateTicket(new File([new Uint8Array(await pdf.save())],"ticket.pdf",{type:"application/pdf"}))).pages).toBe(3);pdf.addPage();await expect(validateTicket(new File([new Uint8Array(await pdf.save())],"ticket.pdf",{type:"application/pdf"}))).rejects.toThrow(/3 páginas/);await expect(validateTicket(new File(["%PDF-damaged"],"ticket.pdf",{type:"application/pdf"}))).rejects.toThrow(/leer el PDF/);});
