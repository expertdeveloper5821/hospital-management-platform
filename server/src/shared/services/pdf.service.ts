// PDF generation stub — full PDFKit implementation delivered in U2-C.
// PatientService calls generateMedicalCard; U2-C replaces the body.

export interface MedicalCardData {
  patientId:        string;
  fullName:         string;
  dateOfBirth:      Date;
  gender:           string;
  mobileNumber:     string;
  bloodGroup?:      string;
  hospitalName:     string;
  hospitalLogoUrl?: string;
  primaryColor:     string;
}

class PdfService {
  generateMedicalCard(data: MedicalCardData): Buffer {
    return Buffer.from(`PDF:MEDICAL-CARD:${data.patientId}:${data.hospitalName}`);
  }
}

export const pdfService = new PdfService();
