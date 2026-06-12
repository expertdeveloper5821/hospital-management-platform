export interface CreateDepartmentRequest {
  name:         string;
  description?: string;
  headDoctorId?: string;
}

export interface UpdateDepartmentRequest {
  name?:         string;
  description?:  string | null;
  headDoctorId?: string | null;
}

export interface DepartmentResponse {
  departmentId:  string;
  name:          string;
  description:   string | null;
  headDoctorId:  string | null;
  tenantId:      string;
  createdAt:     Date;
  updatedAt:     Date;
}
