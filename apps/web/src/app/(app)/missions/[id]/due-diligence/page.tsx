import Link from "next/link";
import type { Metadata } from "next";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  cheminDossiers,
  droitsDd,
  hrefDossier,
  hrefListeDossiers,
  hrefNouveauDossier,
  libellesDossier,
  resumeOperation,
  type DossierResume,
} from "../../../../../lib/due-diligence";
import { chargerTaxonomie } from "../../../../../lib/due-diligence-serveur";
import { formaterDate } from "../../../../../lib/format";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Due diligence" };

/**
 * Dossiers de due diligence de la mission (DD-01) : une opération d'investissement étudiée par
 * dossier (acquisition, entrée sur un marché, partenariat), avec son cadrage versionné.
 */
export default async function PageDossiersDd({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("dd.lire");
  const m = await chargerMission(id);
  // L'en-tête de la mission (layout) affiche déjà son erreur de chargement.
  if (!m.ok) return null;
  const droits = droitsDd(utilisateur.roles, m.donnees);
  const [dossiers, secteurs, pays] = await Promise.all([
    chargerServeur<{ elements: DossierResume[] }>(cheminDossiers(id)),
    chargerTaxonomie("secteur"),
    chargerTaxonomie("pays"),
  ]);

  return (
    <>
      <p className="mp-texte-doux">
        Une due diligence analyse une opération d&apos;investissement : cadrage, analyses sourcées,
        chaîne de valeur, risques, hypothèses à confirmer ou à infirmer, marché, revue
        environnementale et sociale, plan des 100 jours et note au comité. Chaque affirmation est
        sourcée ou signalée fragile ; les chiffres viennent des moteurs de CabinetPilot.
      </p>
      {droits.ecrire ? (
        <div>
          <Link href={hrefNouveauDossier(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>Nouveau dossier</span>
          </Link>
        </div>
      ) : null}
      {!secteurs.ok || !pays.ok ? (
        <Alerte tonalite="attention" titre="Libellés incomplets" annonce="aucune">
          <p>
            Les libellés de secteur ou de pays n&apos;ont pas pu être chargés ; ils s&apos;affichent
            comme « Libellé indisponible » en attendant.
          </p>
        </Alerte>
      ) : null}
      <Carte titre="Dossiers de la mission">
        {!dossiers.ok ? (
          <EtatErreur
            titre="Les dossiers n'ont pas pu être chargés."
            message={dossiers.message}
            hrefReessayer={hrefListeDossiers(id)}
          />
        ) : dossiers.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun dossier de due diligence." icone="dossier">
            <p>
              {droits.ecrire
                ? "Créez un dossier pour cadrer l'opération étudiée : secteur, pays, cible et question d'investissement."
                : "Les dossiers apparaîtront ici dès qu'un consultant en aura créé un."}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-dd-grille" aria-label="Dossiers de due diligence">
            {dossiers.donnees.elements.map((d) => {
              const l = libellesDossier(
                d,
                secteurs.ok ? secteurs.donnees : [],
                pays.ok ? pays.donnees : [],
              );
              return (
                <li key={d.id} className="mp-dd-element">
                  <h3 className="mp-dd-element__titre">
                    <Link href={hrefDossier(id, d.id)}>{d.titre}</Link>
                  </h3>
                  <span className="mp-dd-meta">
                    <BadgeStatut tonalite="neutre" sansIcone>
                      {l.secteur}
                    </BadgeStatut>
                    <BadgeStatut tonalite="neutre" sansIcone>
                      {l.pays}
                    </BadgeStatut>
                  </span>
                  <p className="mp-texte-petit">{resumeOperation(d)}</p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {d.date_operation
                      ? `Opération prévue le ${formaterDate(d.date_operation)}`
                      : "Date d'opération non précisée"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
    </>
  );
}
