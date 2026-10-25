import type { Ref } from "react";
import { classesBouton } from "../../components/ui/Bouton";
import {
  CLE_SUPER_ADMIN_DEMO,
  grouperComptesCabinet,
  libelleNombreComptes,
  libelleRolesDemo,
  type Demo,
  type DemoCabinet,
  type DemoCompte,
} from "../../lib/demo-connexion";

/**
 * Étapes présentationnelles de la connexion de démonstration (aucun état, aucun appel) :
 * `ConnexionDemo.tsx` les pilote. Testées en markup statique (`ConnexionDemo.test.ts`).
 */

/** Ce qui est en cours d'ouverture : une ligne de compte ou la confirmation du super admin. */
export type OuvertureDemo = { type: "compte"; email: string } | { type: "super_admin" } | null;

const Indicateur = () => <span className="mp-bouton__indicateur" aria-hidden="true" />;

function TitreEtape({
  id,
  refTitre,
  children,
}: {
  id: string;
  refTitre?: Ref<HTMLHeadingElement>;
  children: string;
}) {
  return (
    <h3 id={id} ref={refTitre} tabIndex={-1} className="mp-demo__etape-titre">
      {children}
    </h3>
  );
}

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
      <TitreEtape id="titre-demo-choix" refTitre={refTitre}>
        Choisissez un espace
      </TitreEtape>
      {vide ? (
        <p className="mp-texte-doux">
          Aucun cabinet de démonstration pour le moment. Utilisez une adresse e-mail et un mot de
          passe ci-dessous.
        </p>
      ) : (
        <ul className="mp-demo__liste">
          {demo.superAdmin ? (
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
                      <span className="mp-demo__detail">{demo.superAdmin.nom}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ) : null}
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
                  <span className="mp-demo__detail">
                    {libelleNombreComptes(cabinet.comptes.length)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EtapeComptes({
  cabinet,
  occupe,
  ouverture,
  refTitre,
  surCompte,
  surRetour,
}: {
  cabinet: DemoCabinet;
  occupe: boolean;
  ouverture: OuvertureDemo;
  refTitre?: Ref<HTMLHeadingElement>;
  surCompte?: (compte: DemoCompte) => void;
  surRetour?: () => void;
}) {
  const groupes = grouperComptesCabinet(cabinet.comptes);
  return (
    <div className="mp-demo__etape" aria-labelledby="titre-demo-cabinet" role="group">
      <div className="mp-demo__entete">
        <TitreEtape id="titre-demo-cabinet" refTitre={refTitre}>
          {cabinet.nom}
        </TitreEtape>
        <button
          type="button"
          className={classesBouton("discret")}
          disabled={occupe}
          onClick={() => surRetour?.()}
        >
          Retour
        </button>
      </div>
      {groupes.length === 0 ? (
        <p className="mp-texte-doux">Ce cabinet n&apos;a aucun compte de démonstration.</p>
      ) : (
        groupes.map((groupe) => (
          <section
            key={groupe.espace}
            className="mp-demo__groupe"
            aria-labelledby={`titre-demo-groupe-${groupe.espace}`}
          >
            <h4 id={`titre-demo-groupe-${groupe.espace}`} className="mp-demo__sous-titre">
              {groupe.titre}
            </h4>
            <ul className="mp-demo__liste">
              {groupe.comptes.map((compte) => {
                const actif = ouverture?.type === "compte" && ouverture.email === compte.email;
                const roles = libelleRolesDemo(compte.roles);
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
                            {roles ? <span className="mp-demo__detail">{roles}</span> : null}
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
        ))
      )}
    </div>
  );
}
