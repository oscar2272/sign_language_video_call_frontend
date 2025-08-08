import {
  type RouteConfig,
  index,
  layout,
  route,
  prefix,
} from "@react-router/dev/routes";

export default [
  index("common/pages/test-page.tsx"),
  layout("common/layouts/layout.tsx", [
    index("common/pages/home-page.tsx"),
    ...prefix("/friends", [index("features/friends/pages/friends-page.tsx")]),
  ]),
  layout("features/auth/layouts/auth-layout.tsx", [
    route("/auth/signin", "features/auth/pages/login-page.tsx"),
    route("/auth/signup/complete", "features/auth/pages/signup-complete.tsx"),
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
