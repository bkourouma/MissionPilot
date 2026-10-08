import type { FastifyRequest } from "fastify";
import { aPermission, type Permission, type Role } from "@missionpilot/shared";
import { interdit, nonAuthentifie } from "../errors.js";

export interface Auth {
  utilisateurId: string;
  cabinetId: string;
  email: string;
  nom: string;
  roles: Role[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

/** Utilisateur connecté, ou 401. Si `permission` est fourni, vérifie aussi le droit (sinon 403). */
export function exiger(request: FastifyRequest, permission?: Permission): Auth {
  const auth = request.auth;
  if (!auth) throw nonAuthentifie();
  if (permission && !aPermission(auth.roles, permission)) throw interdit();
  return auth;
}
