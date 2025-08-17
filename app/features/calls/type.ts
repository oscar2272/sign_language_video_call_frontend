type CallHistory = {
  id: number;
  caller: any;
  receiver: any;
  called_at: string;
  started_at: string | null;
  ended_at: string | null;
  call_status: "ACCEPTED" | "REJECTED" | "MISSED";
};

type CallHistoryLoaderData = {
  callHistory: {
    count: number;
    next: string | null;
    previous: string | null;
    results: Array<{
      id: number;
      caller: {
        id: number;
        email: string;
        profile?: { nickname?: string; profile_image_url?: string };
      };
      receiver: {
        id: number;
        email: string;
        profile?: { nickname?: string; profile_image_url?: string };
      };
      call_status: "ACCEPTED" | "MISSED" | "REJECTED";
      started_at?: string;
      ended_at?: string;
      called_at: string;
    }>;
  };
};
