type UserProfile = {
  id: number;
  email: string;
  profile: {
    nickname: string | null;
    profile_image_url?: string | null;
  };
};

type FriendRelation = {
  id: number;
  from_user: UserProfile;
  to_user: UserProfile;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
};
