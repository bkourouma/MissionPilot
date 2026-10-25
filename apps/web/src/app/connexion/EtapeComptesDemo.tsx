import type { Ref } from "react";
import { classesBouton } from "../../components/ui/Bouton";
import { type DemoCabinet, type DemoCompte } from "../../lib/demo-connexion";
import {
  espacesDisponibles,
  libelleAutresRoles,
  libelleDetailCabinet,
  optionsRoles,
  vueComptes,
  type EvenementFiltreDemo,
  type FiltreComptesDemo,
} from "../../lib/demo-connexion-comptes";
import type { OuvertureDemo } from "./EtapesDemo";

/**
 * Étape « utilisateurs » de la connexion de démonstration (aucun état, aucun appel) : l'espace
 * (équipe du cabinet ou espace client), puis le rôle filtrent la liste, rangée par rôle.
 * `ConnexionDemo.tsx` la pilote ; testée en markup statique (`ConnexionDemo.test.ts`).
 */

const Indicateur = () => <span className="mp-bouton__indicateur" aria-hidden="true" />;

/** Compte de la vue pour l'annonce vocale « N comptes affichés ». */
function nombreAffiches(groupes: { comptes: DemoCompte[] }[]): number {
  return groupes.reduce((n, g) => n + g.comptes.length, 0);
}

/** « 1 compte affiché », « 12 comptes affichés ». */
function libelleAffiches(n: number): string {
  return n <= 1 ? `${n} compte affiché` : `${n} comptes affichés`;
}

export function EtapeComptes({
  cabinet,
  filtre,
  occupe,
  ouverture,
  refTitre,
  surCompte,
  surFiltre,
  surRetour,
}: {
  cabinet: DemoCabinet;
  filtre: FiltreComptesDemo;
  occupe: boolean;
  ouverture: OuvertureDemo;
  refTitre?: Ref<HTMLHeadingElement>;
  surCompte?: (compte: DemoCompte) => void;
  surFiltre?: (ev: EvenementFiltreDemo) => void;
  surRetour?: () => void;
}) {
  const espaces = espacesDisponibles(cabinet.comptes);
  const roles = optionsRoles(cabinet.comptes, filtre.espace);
  const groupes = vueComptes(cabinet.comptes, filtre);
  return (
    <div className="mp-demo__etape" aria-labelledby="titre-demo-cabinet" role="group">
      <div className="mp-demo__entete">
        <div className="mp-demo__identite">
          <h3 id="titre-demo-cabinet" ref={refTitre} tabIndex={-1} className="mp-demo__etape-titre">
            {cabinet.nom}
          </h3>
          <span className="mp-demo__badge">Démonstration</span>
        </div>
        <button
          type="button"
          className={classesBouton("discret")}
          disabled={occupe}
          onClick={() => surRetour?.()}
        >
          Retour
        </button>
      </div>
      {espaces.length === 0 ? (
        <p className="mp-texte-doux">Ce cabinet n&apos;a aucun compte de démonstration.</p>
      ) : (
        <>
          <p className="mp-texte-doux mp-demo__aide">
            {libelleDetailCabinet(cabinet.comptes)}. Cliquez sur un utilisateur pour ouvrir sa
            session.
          </p>
          {espaces.length > 1 ? (
            <div className="mp-demo__filtre" role="group" aria-label="Espace">
              {espaces.map((e) => (
                <button
                  key={e.espace}
                  type="button"
                  className="mp-demo__segment"
                  aria-pressed={filtre.espace === e.espace}
                  onClick={() => surFiltre?.({ type: "espace", espace: e.espace })}
                >
                  {e.titre} <span className="mp-demo__nombre">{e.nombre}</span>
                </button>
              ))}
            </div>
          ) : null}
          {roles.length > 1 ? (
            <div className="mp-demo__filtre mp-demo__filtre--roles" role="group" aria-label="Rôle">
              {roles.map((r) => (
                <button
                  key={r.cle}
                  type="button"
                  className="mp-demo__puce"
                  aria-pressed={filtre.role === r.cle}
                  onClick={() => surFiltre?.({ type: "role", role: r.cle })}
                >
                  {r.libelle} <span className="mp-demo__nombre">{r.nombre}</span>
                </button>
              ))}
            </div>
          ) : null}
          <p className="mp-visuellement-cache" role="status" aria-live="polite">
            {libelleAffiches(nombreAffiches(groupes))}
          </p>
          {groupes.map((groupe) => (
            <section
              key={groupe.cle}
              className="mp-demo__groupe"
              aria-labelledby={`titre-demo-role-${groupe.cle}`}
            >
              <h4 id={`titre-demo-role-${groupe.cle}`} className="mp-demo__sous-titre">
                {groupe.libelle} <span className="mp-demo__nombre">{groupe.comptes.length}</span>
              </h4>
              <ul className="mp-demo__liste mp-demo__liste--grille">
                {groupe.comptes.map((compte) => {
                  const actif = ouverture?.type === "compte" && ouverture.email === compte.email;
                  const autres = libelleAutresRoles(compte);
                  return (
                    <li key={compte.email}>
                      <button
                        type="button"
                        className={`${classesBouton("secondaire", true)} mp-demo__carte`}
                        aria-busy={actif || undefined}
                        aria-disabled={actif || undefined}
                        disabled={occupe && !actif}
                        onClick={() => surCompte?.(compte)}
                      >
                        {actif ? <Indicateur /> : null}
                        <span className="mp-demo__texte">
                          <span className="mp-demo__nom">{compte.nom}</span>
                          {actif ? (
                            <span className="mp-demo__detail">Connexion en cours…</span>
                          ) : (
                            <>
                              {autres ? <span className="mp-demo__detail">{autres}</span> : null}
                              <span className="mp-demo__email">{compte.email}</span>
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
