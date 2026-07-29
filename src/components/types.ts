export type ConnectionStatus = "active" | "warm" | "cold" | "archived";

export type ConnectionView = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  profileUrl: string | null;
  tags: string[];
  notes: string;
  status: ConnectionStatus;
  lastContactedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};
