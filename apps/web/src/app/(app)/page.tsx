import Link from "next/link";
import type { Metadata } from "next";
import { libellesRoles } from "../../components/shell/CadreApplication";
import { BadgeStatut } from "../../components/ui/BadgeStatut";
import { Carte } from "../../components/ui/Carte";
import { Icone } from "../../components/ui/Icone";
import { aPermission } from "@missionpilot/shared";
import {
  GrilleIndicateurs,
  ListeAlertesDerive,
} from "../../components/indicateurs/GrilleIndicateurs";
import { chargerServeur } from "../../lib/api-serveur";
import { formaterDate } from "../../lib/format";
import {
  alertesDerive,
  indicateursAffiches,
  periodeParDefaut,
  requeteIndicateurs,
  type ElementMission,
  type ReponseIndicateurs,
} from "../../lib/indicateurs";
import { entreesAutorisees } from "../../lib/navigation";
import { obtenirSession } from "../../lib/session";

export const metadata: Metadata = { title: "Tableau de bord" };

export default async function TableauDeBord() {
  const { utilisateur } = await obtenirSession();
  const modules = entreesAutorisees(utilisateur.roles).filter((e) => e.id !== "tableau-de-bord");
  // Pilotage du cabinet (parcours C) : une seule requête de niveau « mission » sert à la fois
  // les indicateurs du cabinet et les alertes de dérive.
  const pilotage = aPermission(utilisateur.roles, "indicateurs.cabinet")
    ? await chargerServeur<ReponseIndicateurs>(
        `/api/indicateurs/cabinet?${requeteIndicateurs({ ...periodeParDefaut(), niveau: "mission" })}`,
      )
    : null;

  return (
    <div className="mp-page">
      <header className="mp-page__entete">
        <h1 className="mp-page__titre">Tableau de bord</h1>
        <p className="mp-page__soustitre">
          Bonjour {utilisateur.nom}. Vous êtes connecté en tant que{" "}
          {libellesRoles(utilisateur.roles)}.
        </p>
      </header>

      {pilotage ? (
        <section aria-labelledby="titre-pilotage" className="mp-pile">
          <h2 id="titre-pilotage" className="mp-section__titre">
            Pilotage du mois
          </h2>
          {pilotage.ok ? (
            <>
              <Carte titre="Alertes de dérive" niveauTitre={3}>
                <ListeAlertesDerive
                  alertes={alertesDerive(pilotage.donnees.elements as ElementMission[])}
                  limite={5}
                />
              </Carte>
              <p className="mp-texte-doux">
                {`Du ${formaterDate(pilotage.donnees.du)} au ${formaterDate(pilotage.donnees.au)}, montants en ${pilotage.donnees.devise}. `}
                <Link href="/indicateurs">Changer de période ou de niveau de lecture</Link>
              </p>
              <GrilleIndicateurs indicateurs={indicateursAffiches(pilotage.donnees)} />
            </>
          ) : (
            <p className="mp-texte-doux">
              {`Indicateurs indisponibles : ${pilotage.message}`}{" "}
              <Link href="/indicateurs">Ouvrir les indicateurs</Link>
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="titre-modules">
        <h2 id="titre-modules" className="mp-section__titre">
          Vos modules
        </h2>
        <p className="mp-texte-doux">
          Les modules accessibles avec votre rôle. Ceux marqués « Pas encore disponible » seront
          ouverts au fil des livraisons.
        </p>
        {modules.length === 0 ? (
          <p>Votre rôle ne donne accès à aucun module pour l&apos;instant.</p>
        ) : (
          <ul className="mp-grille-modules">
            {modules.map((m) => (
              <li key={m.id}>
                <Carte
                  niveauTitre={3}
                  className={m.disponible ? "mp-module" : "mp-module mp-module--indisponible"}
                  titre={
                    <span className="mp-module__titre">
                      <Icone nom={m.icone} />
                      {m.disponible ? (
                        <Link href={m.href} className="mp-lien-etendu">
                          {m.libelle}
                        </Link>
                      ) : (
                        m.libelle
                      )}
                    </span>
                  }
                  actions={
                    m.disponible ? (
                      <BadgeStatut tonalite="succes">Disponible</BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="neutre">Pas encore disponible</BadgeStatut>
                    )
                  }
                >
                  <p>{m.description}</p>
                </Carte>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Carte titre="Votre compte" className="mp-compte">
        <dl className="mp-liste-def">
          <div>
            <dt>Nom</dt>
            <dd>{utilisateur.nom}</dd>
          </div>
          <div>
            <dt>Adresse e-mail</dt>
            <dd>{utilisateur.email}</dd>
          </div>
          <div>
            <dt>Rôle</dt>
            <dd>{libellesRoles(utilisateur.roles)}</dd>
          </div>
        </dl>
      </Carte>
    </div>
  );
}
