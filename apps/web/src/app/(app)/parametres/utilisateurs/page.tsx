import type { Metadata } from "next";
import { libellesRoles } from "../../../../components/shell/CadreApplication";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import type { Invitation, Utilisateur } from "../../../../lib/utilisateurs";
import { FormulaireInvitationEnvoi } from "./FormulaireInvitationEnvoi";
import { GestionUtilisateur } from "./GestionUtilisateur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Utilisateurs", "Users") };
}

export default async function PageUtilisateurs() {
  const session = await exigerPermission("cabinet.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const [utilisateurs, invitations] = await Promise.all([
    chargerServeur<{ elements: Utilisateur[] }>("/api/utilisateurs"),
    chargerServeur<{ elements: Invitation[] }>("/api/invitations"),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Utilisateurs", "Users")}
        soustitre={t(
          "Comptes du cabinet, rôles et invitations. Un rôle détermine les écrans et les données accessibles.",
          "Firm accounts, roles and invitations. A role determines which screens and data are accessible.",
        )}
      />

      <Carte titre={t("Inviter une personne", "Invite a person")}>
        <FormulaireInvitationEnvoi />
      </Carte>

      <section aria-labelledby="titre-invitations" className="mp-pile">
        <h2 id="titre-invitations" className="mp-section__titre">
          {t("Invitations en attente", "Pending invitations")}
        </h2>
        {!invitations.ok ? (
          <EtatErreur
            titre={t(
              "Les invitations n'ont pas pu être chargées.",
              "The invitations could not be loaded.",
            )}
            message={invitations.message}
            hrefReessayer="/parametres/utilisateurs"
          />
        ) : invitations.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucune invitation en attente.", "No pending invitations.")}
            icone="courrier"
          >
            <p>
              {t(
                "Les invitations acceptées ou expirées n'apparaissent plus ici.",
                "Accepted or expired invitations no longer appear here.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {invitations.donnees.elements.map((i) => (
              <li key={i.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong className="mp-coupure">{i.email}</strong>
                  <span className="mp-texte-doux">
                    {libellesRoles(i.roles, langue)} · {t("expire le", "expires on")}{" "}
                    {formaterDate(i.expire_le, "Africa/Abidjan", langue)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-comptes" className="mp-pile">
        <h2 id="titre-comptes" className="mp-section__titre">
          {t("Comptes", "Accounts")}
        </h2>
        {!utilisateurs.ok ? (
          <EtatErreur
            titre={t(
              "La liste des utilisateurs n'a pas pu être chargée.",
              "The list of users could not be loaded.",
            )}
            message={utilisateurs.message}
            hrefReessayer="/parametres/utilisateurs"
          />
        ) : utilisateurs.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucun utilisateur.", "No users.")} />
        ) : (
          <ul className="mp-liste-cartes">
            {utilisateurs.donnees.elements.map((u) => (
              <li key={u.id}>
                <Carte
                  niveauTitre={3}
                  titre={u.nom}
                  actions={
                    <span className="mp-badges">
                      {u.actif ? (
                        <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
                      ) : (
                        <BadgeStatut tonalite="neutre">{t("Désactivé", "Deactivated")}</BadgeStatut>
                      )}
                      {u.tfa_active ? (
                        <BadgeStatut tonalite="succes">
                          {t("Double authentification", "Two-factor authentication")}
                        </BadgeStatut>
                      ) : (
                        <BadgeStatut tonalite="neutre">
                          {t("Sans double authentification", "No two-factor authentication")}
                        </BadgeStatut>
                      )}
                    </span>
                  }
                >
                  <p className="mp-coupure">{u.email}</p>
                  <p className="mp-texte-doux">{libellesRoles(u.roles, langue)}</p>
                  <GestionUtilisateur
                    utilisateur={u}
                    estSoiMeme={u.id === session.utilisateur.id}
                    moiId={session.utilisateur.id}
                  />
                </Carte>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
