import Link from "next/link";
import type { ReactNode } from "react";
import { CadreApplication } from "../../components/shell/CadreApplication";
import { Alerte } from "../../components/ui/Alerte";
import { obtenirT } from "../../lib/i18n/serveur";
import { CHEMIN_SECURITE_COMPTE, entreesAutorisees } from "../../lib/navigation";
import { obtenirSession } from "../../lib/session";

/** Garde serveur : toute page de ce groupe exige une session valide (sinon /connexion). */
export default async function LayoutApplication({ children }: { children: ReactNode }) {
  const session = await obtenirSession();
  const t = await obtenirT();
  const { utilisateur } = session;
  return (
    <CadreApplication
      nom={utilisateur.nom}
      roles={utilisateur.roles}
      entrees={entreesAutorisees(utilisateur.roles)}
    >
      {session.tfa_a_configurer ? (
        <div className="mp-bandeau-tfa">
          <Alerte
            tonalite="attention"
            annonce="aucune"
            titre={t("Configurez la double authentification", "Set up two-factor authentication")}
          >
            <p>
              {t(
                "Votre cabinet l'exige pour votre rôle : elle protège l'accès aux données financières et aux clients.",
                "Your firm requires it for your role: it protects access to financial and client data.",
              )}{" "}
              <Link href={CHEMIN_SECURITE_COMPTE}>{t("Activer maintenant", "Enable now")}</Link>
            </p>
          </Alerte>
        </div>
      ) : null}
      {children}
    </CadreApplication>
  );
}
