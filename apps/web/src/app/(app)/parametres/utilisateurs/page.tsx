import type { Metadata } from "next";
import { libellesRoles } from "../../../../components/shell/CadreApplication";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";
import type { Invitation, Utilisateur } from "../../../../lib/utilisateurs";
import { FormulaireInvitationEnvoi } from "./FormulaireInvitationEnvoi";
import { GestionUtilisateur } from "./GestionUtilisateur";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function PageUtilisateurs() {
  const session = await exigerPermission("cabinet.gerer");
  const [utilisateurs, invitations] = await Promise.all([
    chargerServeur<{ elements: Utilisateur[] }>("/api/utilisateurs"),
    chargerServeur<{ elements: Invitation[] }>("/api/invitations"),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Utilisateurs"
        soustitre="Comptes du cabinet, rôles et invitations. Un rôle détermine les écrans et les données accessibles."
      />

      <Carte titre="Inviter une personne">
        <FormulaireInvitationEnvoi />
      </Carte>

      <section aria-labelledby="titre-invitations" className="mp-pile">
        <h2 id="titre-invitations" className="mp-section__titre">
          Invitations en attente
        </h2>
        {!invitations.ok ? (
          <EtatErreur
            titre="Les invitations n'ont pas pu être chargées."
            message={invitations.message}
            hrefReessayer="/parametres/utilisateurs"
          />
        ) : invitations.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune invitation en attente." icone="courrier">
            <p>Les invitations acceptées ou expirées n&apos;apparaissent plus ici.</p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {invitations.donnees.elements.map((i) => (
              <li key={i.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong className="mp-coupure">{i.email}</strong>
                  <span className="mp-texte-doux">
                    {libellesRoles(i.roles)} · expire le{" "}
                    {formaterDate(i.expire_le, "Africa/Abidjan")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-comptes" className="mp-pile">
        <h2 id="titre-comptes" className="mp-section__titre">
          Comptes
        </h2>
        {!utilisateurs.ok ? (
          <EtatErreur
            titre="La liste des utilisateurs n'a pas pu être chargée."
            message={utilisateurs.message}
            hrefReessayer="/parametres/utilisateurs"
          />
        ) : utilisateurs.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun utilisateur." />
        ) : (
          <ul className="mp-liste-cartes">
            {utilisateurs.donnees.elements.map((u) => (
              <li key={u.id}>
                <Carte
                  niveauTitre={3}
                  titre={u.nom}
                  actions={
                    u.actif ? (
                      <BadgeStatut tonalite="succes">Actif</BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">Désactivé</BadgeStatut>
                    )
                  }
                >
                  <p className="mp-coupure">{u.email}</p>
                  <p className="mp-texte-doux">{libellesRoles(u.roles)}</p>
                  <GestionUtilisateur
                    utilisateur={u}
                    estSoiMeme={u.id === session.utilisateur.id}
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
