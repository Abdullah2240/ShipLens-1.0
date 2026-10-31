// Framework-free HTTP layer. Page helpers that need next/headers live in ./server and are
// imported from '@/platform/http/server' directly, never re-exported here.
export { createRoute, route } from './route';
export type {
  NextRouteContext,
  RouteContext,
  RouteDeps,
  RouteHandler,
  RouteOptions,
  RouteResult,
} from './route';
export { isAllowedOrigin, isMutatingMethod } from './origin';
