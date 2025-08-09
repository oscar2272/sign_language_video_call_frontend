import {
  type RouteConfig,
  index,
  layout,
  route,
  prefix,
} from "@react-router/dev/routes";

export default [
  layout("common/layouts/layout.tsx", [
    index("common/pages/home-page.tsx"),
    route("/profiles", "features/profiles/pages/profile-page.tsx"),
    route("/profiles/edit", "features/profiles/pages/profile-edit-page.tsx"),
    ...prefix("/friends", [index("features/friends/pages/friends-page.tsx")]),
    route("/test", "common/pages/test-page.tsx"),
  ]),
  layout("features/auth/layouts/auth-layout.tsx", [
    route("/auth/signin", "features/auth/pages/login-page.tsx"),
    // route("/auth/signup/confirm", "features/auth/pages/email-confirm-page.tsx"),
    // route("/auth/signup/complete", "features/auth/pages/signup-complete.tsx"),
    route("/auth/signup", "features/auth/pages/signup-page.tsx"),
    route("/auth/logout", "features/auth/pages/logout-loader.tsx"),
    ...prefix("/auth", [
      ...prefix("/social", [
        route("/:provider/start", "features/auth/pages/social-start-page.tsx"),
        route(
          "/:provider/complete",
          "features/auth/pages/social-complete-page.tsx"
        ),
      ]),
    ]),
  ]),
] satisfies RouteConfig;
