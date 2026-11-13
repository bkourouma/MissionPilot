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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Due diligence", "Due diligence") };
}

/**
 * Dossiers de due diligence de la mission (DD-01) : une opération d'investissement étudiée par
 * dossier (acquisition, entrée sur un marché, partenariat), avec son cadrage versionné.
 */
export default async function PageDossiersDd({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
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
        {t(
          "Une due diligence analyse une opération d'investissement : cadrage, analyses sourcées, chaîne de valeur, risques, hypothèses à confirmer ou à infirmer, marché, revue environnementale et sociale, plan des 100 jours et note au comité. Chaque affirmation est sourcée ou signalée fragile ; les chiffres viennent des moteurs de CabinetPilot.",
          "A due diligence analyzes an investment transaction: scoping, sourced analyses, value chain, risks, hypotheses to confirm or refute, market, environmental and social review, 100-day plan and committee memo. Each statement is sourced or flagged weak; the figures come from the CabinetPilot engines.",
        )}
      </p>
      {droits.ecrire ? (
        <div>
          <Link href={hrefNouveauDossier(id)} className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>{t("Nouveau dossier", "New file")}</span>
          </Link>
        </div>
      ) : null}
      {!secteurs.ok || !pays.ok ? (
        <Alerte
          tonalite="attention"
          titre={t("Libellés incomplets", "Incomplete labels")}
          annonce="aucune"
        >
          <p>
            {t(
              "Les libellés de secteur ou de pays n'ont pas pu être chargés ; ils s'affichent comme « Libellé indisponible » en attendant.",
              "The sector or country labels could not be loaded; they are shown as “Label unavailable” in the meantime.",
            )}
          </p>
        </Alerte>
      ) : null}
      <Carte titre={t("Dossiers de la mission", "Engagement files")}>
        {!dossiers.ok ? (
          <EtatErreur
            titre={t("Les dossiers n'ont pas pu être chargés.", "The files could not be loaded.")}
            message={dossiers.message}
            hrefReessayer={hrefListeDossiers(id)}
          />
        ) : dossiers.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucun dossier de due diligence.", "No due diligence file.")}
            icone="dossier"
          >
            <p>
              {droits.ecrire
                ? t(
                    "Créez un dossier pour cadrer l'opération étudiée : secteur, pays, cible et question d'investissement.",
                    "Create a file to scope the transaction under study: sector, country, target and investment question.",
                  )
                : t(
                    "Les dossiers apparaîtront ici dès qu'un consultant en aura créé un.",
                    "Files will appear here as soon as a consultant creates one.",
                  )}
            </p>
          </EtatVide>
        ) : (
          <ul
            className="mp-dd-grille"
            aria-label={t("Dossiers de due diligence", "Due diligence files")}
          >
            {dossiers.donnees.elements.map((d) => {
              const l = libellesDossier(
                d,
                secteurs.ok ? secteurs.donnees : [],
                pays.ok ? pays.donnees : [],
                langue,
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
                  <p className="mp-texte-petit">{resumeOperation(d, langue)}</p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {d.date_operation
                      ? t(
                          `Opération prévue le ${formaterDate(d.date_operation)}`,
                          `Transaction planned on ${formaterDate(d.date_operation, "UTC", langue)}`,
                        )
                      : t("Date d'opération non précisée", "Transaction date not specified")}
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
