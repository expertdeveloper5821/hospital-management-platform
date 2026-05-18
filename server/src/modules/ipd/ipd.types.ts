export interface CreateWardRequest {
  name:   string;
  floor?: string;
}

export interface AddBedsRequest {
  bedNumbers: string[]; // e.g. ["G-01", "G-02", "G-03"]
}

export interface WardOccupancySummary {
  wardId:    string;
  wardName:  string;
  floor:     string | null;
  total:     number;
  occupied:  number;
  available: number;
}
