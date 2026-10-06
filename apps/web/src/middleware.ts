import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSION, ENTETE_CHEMIN } from "./lib/connexion";

/**
 * Premier filtre : sans cookie de session, toute page hors /connexion renvoie vers la
 * connexion. La présence du cookie ne prouve rien : la garde réelle est côté serveur
 * (`obtenirSession` dans le layout applicatif), qui interroge l'API.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const connecte = request.cookies.has(COOKIE_SESSION);

  if (!connecte && pathname !== "/connexion") {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = pathname === "/" ? "" : `?suite=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const entetes = new Headers(request.headers);
  entetes.set(ENTETE_CHEMIN, pathname + search);
  return NextResponse.next({ request: { headers: entetes } });
}

export const config = {
  // Exclut l'API relayée, les fichiers de Next et les ressources publiques (PWA, icônes).
  matcher: [
    "/((?!api/|_next/static|_next/image|manifest\\.webmanifest|icon\\.svg|icones/|favicon\\.ico|robots\\.txt).*)",
  ],
};
