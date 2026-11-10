export type Status = "Open" | "Won" | "Lost" | "Ghosted";
export interface Fade { fader: string; amount: string; paid: boolean }
export interface Claim {
  id: number; caller: string; text: string; x_handle: string | null; x_link: string | null;
  stake: string; total_faded: string; created_at: string; deadline: string; status: Status;
  resolved_at: string | null; resolved_by: string | null; caller_paid: boolean; fades: Fade[];
}
export interface Profile {
  calls: number; wins: number; losses: number; ghosted: number;
  total_staked: string; total_faded: string; fades: number;
}
export interface ProfileView extends Profile { account_id: string }
