import type { Ref } from "react";
import { classesBouton } from "../../components/ui/Bouton";
import { CLE_SUPER_ADMIN_DEMO, type Demo, type DemoCabinet } from "../../lib/demo-connexion";
import { libelleDetailCabinet } from "../../lib/demo-connexion-comptes";

/**
 * Étape « choix de l'espace » de la connexion de démonstration (aucun état, aucun appel) :
 * `ConnexionDemo.tsx` la pilote. L'étape des comptes est dans `EtapeComptesDemo.tsx`. Testées en
 * markup statique (`ConnexionDemo.test.ts`).
 */

/** Ce qui est en cours d'ouverture : une ligne de compte ou la carte du super admin. */
export type OuvertureDemo = { type: "compte"; email: string } | { type: "super_admin" } | null;

const Indicateur = () => <span className="mp-bouton__indicateur" aria-hidden="true" />;

export function EtapeChoix({
  demo,
  occupe,
  ouverture = null,
  refTitre,
  enregistrerCarte,
  surCabinet,
  surSuperAdmin,
}: {
  demo: Demo;
  occupe: boolean;
  /** Ouverture de session en cours (la carte « Super administrateur » affiche le chargement). */
  ouverture?: OuvertureDemo;
  refTitre?: Ref<HTMLHeadingElement>;
  /** Mémorise le bouton d'une carte (clé : `CLE_SUPER_ADMIN_DEMO` ou id du cabinet). */
  enregistrerCarte?: (cle: string, element: HTMLButtonElement | null) => void;
  surCabinet?: (cabinet: DemoCabinet) => void;
  surSuperAdmin?: () => void;
}) {
  const vide = demo.superAdmin === null && demo.cabinets.length === 0;
  const superAdminEnCours = ouverture?.type === "super_admin";
  return (
    <div className="mp-demo__etape" aria-labelledby="titre-demo-choix" role="group">
      <h3 id="titre-demo-choix" ref={refTitre} tabIndex={-1} className="mp-demo__etape-titre">
        Choisissez un espace
      </h3>
      {vide ? (
        <p className="mp-texte-doux">
          Aucun cabinet de démonstration pour le moment. Utilisez une adresse e-mail et un mot de
          passe ci-dessous.
        </p>
      ) : null}
      {demo.cabinets.length > 0 ? (
        <section className="mp-demo__groupe" aria-labelledby="titre-demo-cabinets">
          <h4 id="titre-demo-cabinets" className="mp-demo__sous-titre">
            Cabinets de démonstration
          </h4>
          <ul className="mp-demo__liste mp-demo__liste--grille">
            {demo.cabinets.map((cabinet) => (
              <li key={cabinet.id}>
                <button
                  type="button"
                  ref={(el) => enregistrerCarte?.(cabinet.id, el)}
                  className={`${classesBouton("secondaire", true)} mp-demo__carte`}
                  disabled={occupe}
                  onClick={() => surCabinet?.(cabinet)}
                >
                  <span className="mp-demo__texte">
                    <span className="mp-demo__nom">{cabinet.nom}</span>
                    <span className="mp-demo__detail">{libelleDetailCabinet(cabinet.comptes)}</span>
                    <span className="mp-demo__badge">Démonstration</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {demo.superAdmin ? (
        <section className="mp-demo__groupe" aria-labelledby="titre-demo-plateforme">
          <h4 id="titre-demo-plateforme" className="mp-demo__sous-titre">
            Plateforme
          </h4>
          <ul className="mp-demo__liste">
            <li>
              <button
                type="button"
                ref={(el) => enregistrerCarte?.(CLE_SUPER_ADMIN_DEMO, el)}
                className={`${classesBouton("secondaire", true)} mp-demo__carte`}
                aria-busy={superAdminEnCours || undefined}
                aria-disabled={superAdminEnCours || undefined}
                disabled={occupe && !superAdminEnCours}
                onClick={() => surSuperAdmin?.()}
              >
                {superAdminEnCours ? <Indicateur /> : null}
                <span className="mp-demo__texte">
                  <span className="mp-demo__nom">Super administrateur</span>
                  {superAdminEnCours ? (
                    <span className="mp-demo__detail">Connexion en cours…</span>
                  ) : (
                    <>
                      <span className="mp-demo__detail">
                        Créer des cabinets et gérer leurs comptes
                      </span>
                      <span className="mp-demo__email">{demo.superAdmin.nom}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
