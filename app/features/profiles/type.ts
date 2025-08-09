export type UserProfile = {
  id: number;
  email: string;
  is_active: boolean;
  is_staff: boolean;
  profile: {
    nickname: string;
    profile_image_url: string | null;
    created_at: string;
  };
};
