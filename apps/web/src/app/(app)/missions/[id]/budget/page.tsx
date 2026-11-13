import type { Metadata } from "next";
import { obtenirLangue } from "../../../../../lib/i18n/serveur";
import { creerTraduire, type Langue, type Traduire } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  actionsBudget,
  budgetVisible,
  comparaisonVisible,
  droitsBudget,
  etatVersion,
  libelleVersion,
  lireComparaison,
  libelleNature,
  statutEcart,
  type BudgetMission,
  type Comparaison,
  type DroitsBudget,
  type VersionBudget,
} from "../../../../../lib/budget";
import {
  formaterDate,
  formaterDateHeure,
  formaterJours,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
  type Devise,
  libelleDevise,
} from "../../../../../lib/format";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { ActionsBudget } from "./ActionsBudget";

export async function generateMetadata(): Promise<Metadata> {
  const t = creerTraduire(await obtenirLangue());
  return { title: t("Budget de la mission", "Engagement budget") };
}

export default async function PageBudget({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const { utilisateur } = await exigerPermission("budget.lire_jours");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsBudget(roles);
  const b = await chargerServeur<BudgetMission>(`/api/missions/${m.id}/budget`);
  if (!b.ok) {
    return (
      <EtatErreur
        titre={t("Le budget n'a pas pu être chargé.", "The budget could not be loaded.")}
        message={b.message}
        hrefReessayer={`/missions/${m.id}/budget`}
      />
    );
  }
  // Défense en profondeur : rien au-delà des droits n'est rendu, même si l'API l'envoyait.
  const budget = budgetVisible(b.donnees, droits);
  const choix = lireComparaison(await searchParams, budget.versions);
  const comparaison = choix
    ? await chargerServeur<Comparaison>(
        `/api/missions/${m.id}/budget/comparaison?avant=${choix.avant}&apres=${choix.apres}`,
      )
    : null;
  const enCours = budget.versions.find((v) => v.id === budget.en_cours_id);
  const actions = actionsBudget(
    roles,
    { statut: m.statut, modifiable: droitsMission(m, roles, utilisateur.id, langue).responsable },
    budget,
    {
      utilisateurId: utilisateur.id,
      directeurId: m.directeur_id,
      auteurEnCours: enCours?.cree_par ?? null,
    },
    langue,
  );
  const versions = [...budget.versions].reverse();
  const options = budget.versions.map((v) => ({
    valeur: v.id,
    libelle: libelleVersion(v, langue),
  }));

  return (
    <div className="mp-pile mp-pile--large">
      {budget.versions.length === 0 ? (
        <EtatVide titre={t("Pas encore de budget signé.", "No signed budget yet.")} icone="cadenas">
          <p>
            {t(
              "Le budget initial est calculé depuis le découpage et figé à la signature de la lettre de mission (onglet Fiche).",
              "The initial budget is computed from the work breakdown and frozen when the engagement letter is signed (Profile tab).",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre={t("Versions de budget", "Budget versions")}>
            <div className="mp-pile">
              <p className="mp-texte-doux">
                {t(
                  `Devise : ${libelleDevise(budget.devise)}.`,
                  `Currency: ${libelleDevise(budget.devise)}.`,
                )}
                {budget.taux_change !== null &&
                budget.devise_reference &&
                budget.devise_reference !== budget.devise
                  ? t(
                      ` Taux figé à la signature : 1 ${libelleDevise(budget.devise)} = ${formaterNombre(budget.taux_change, 6, langue)} ${libelleDevise(budget.devise_reference)}.`,
                      ` Rate frozen at signing: 1 ${libelleDevise(budget.devise)} = ${formaterNombre(budget.taux_change, 6, langue)} ${libelleDevise(budget.devise_reference)}.`,
                    )
                  : ""}{" "}
                {t(
                  "L'initial signé reste dans l'historique ; chaque révision validée devient la référence.",
                  "The signed initial budget stays in the history; each approved revision becomes the baseline.",
                )}
              </p>
              <ActionsBudget
                missionId={m.id}
                actions={actions}
                enCoursId={budget.en_cours_id}
                enCoursLibelle={enCours ? libelleVersion(enCours, langue) : null}
              />
            </div>
          </Carte>

          {versions.map((v) => (
            <CarteVersion
              key={v.id}
              version={v}
              referenceId={budget.reference_id}
              droits={droits}
              t={t}
              langue={langue}
            />
          ))}

          {budget.versions.length >= 2 ? (
            <Carte titre={t("Comparer deux versions", "Compare two versions")}>
              <div className="mp-pile">
                <form
                  method="get"
                  className="mp-filtres"
                  aria-label={t(
                    "Choisir les versions à comparer",
                    "Choose the versions to compare",
                  )}
                >
                  <div className="mp-grille-champs mp-grille-champs--filtres">
                    <Select
                      libelle={t("Version de départ", "Starting version")}
                      name="avant"
                      options={options}
                      defaultValue={choix?.avant ?? budget.versions[0]?.id}
                    />
                    <Select
                      libelle={t("Version comparée", "Version compared")}
                      name="apres"
                      options={options}
                      defaultValue={choix?.apres ?? budget.versions.at(-1)?.id}
                    />
                  </div>
                  <div className="mp-actions-formulaire">
                    <button type="submit" className={classesBouton("secondaire")}>
                      <Icone nom="barres" />
                      <span>{t("Comparer", "Compare")}</span>
                    </button>
                  </div>
                </form>
                {comparaison ? (
                  comparaison.ok ? (
                    <ResultatComparaison
                      c={comparaisonVisible(comparaison.donnees, droits)}
                      devise={budget.devise}
                      t={t}
                      langue={langue}
                    />
                  ) : (
                    <EtatErreur
                      titre={t(
                        "La comparaison n'a pas pu être calculée.",
                        "The comparison could not be computed.",
                      )}
                      message={comparaison.message}
                      hrefReessayer={`/missions/${m.id}/budget`}
                    />
                  )
                ) : null}
              </div>
            </Carte>
          ) : null}
        </>
      )}
    </div>
  );
}

function CarteVersion({
  version: v,
  referenceId,
  droits,
  t,
  langue,
}: {
  version: VersionBudget;
  referenceId: string | null;
  droits: DroitsBudget;
  t: Traduire;
  langue: Langue;
}) {
  const etat = etatVersion(v, referenceId, v.id, langue);
  const s = v.synthese;
  const devise = v.devise as Devise;
  const montant = (x: number | undefined) => formaterMontantMineur(x, devise, langue);
  return (
    <Carte
      titre={libelleVersion(v, langue)}
      niveauTitre={3}
      actions={
        <BadgeStatut tonalite={etat.tonalite} sansIcone>
          {v.figee ? (
            <span className="mp-badge__interne">
              <Icone nom="cadenas" taille={14} />
              {etat.libelle}
            </span>
          ) : (
            etat.libelle
          )}
        </BadgeStatut>
      }
    >
      <div className="mp-pile">
        <dl className="mp-liste-def mp-liste-def--compacte">
          {v.motif ? (
            <div>
              <dt>{t("Motif", "Reason")}</dt>
              <dd className="mp-texte-preserve">{v.motif}</dd>
            </div>
          ) : null}
          <div>
            <dt>{v.figee ? t("Figée le", "Frozen on") : t("Créée le", "Created on")}</dt>
            <dd>
              {v.figee
                ? formaterDate(v.date_figeage, "UTC", langue)
                : formaterDateHeure(v.cree_le, "Africa/Abidjan", langue)}
            </dd>
          </div>
          <div>
            <dt>{t("Jours vendus", "Days sold")}</dt>
            <dd>{formaterJours(s.jours_vendus, langue)}</dd>
          </div>
          {droits.montants && s.honoraires !== undefined ? (
            <>
              <div>
                <dt>{t("Honoraires", "Fees")}</dt>
                <dd>{montant(s.honoraires)}</dd>
              </div>
              <div>
                <dt>{t("Débours refacturables", "Rebillable expenses")}</dt>
                <dd>{montant(s.debours_refacturables)}</dd>
              </div>
              <div>
                <dt>{t("Débours non refacturables", "Non-rebillable expenses")}</dt>
                <dd>{montant(s.debours_non_refacturables)}</dd>
              </div>
            </>
          ) : null}
          {droits.finance && s.marge !== undefined ? (
            <>
              <div>
                <dt>{t("Coûts internes", "Internal costs")}</dt>
                <dd>{montant(s.couts_internes)}</dd>
              </div>
              <div>
                <dt>{t("Sous-traitance", "Subcontracting")}</dt>
                <dd>{montant(s.sous_traitance)}</dd>
              </div>
              <div>
                <dt>{t("Marge", "Margin")}</dt>
                <dd>
                  {`${montant(s.marge)} (${formaterPourcentage(s.taux_marge ?? null, 1, langue)})`}{" "}
                  <span className="mp-mention-confidentielle">
                    {t("Confidentiel", "Confidential")}
                  </span>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <details className="mp-details">
          <summary>
            {t(
              `Lignes du budget (${formaterNombre(v.lignes.length, 0, langue)})`,
              `Budget lines (${formaterNombre(v.lignes.length, 0, langue)})`,
            )}
          </summary>
          <Tableau
            legende={t(
              `Lignes de ${libelleVersion(v, langue)}`,
              `Lines of ${libelleVersion(v, langue)}`,
            )}
            lignes={v.lignes}
            cleLigne={(l) => l.id}
            messageVide={t("Aucune ligne visible.", "No visible lines.")}
            colonnes={[
              {
                cle: "libelle",
                entete: t("Ligne", "Line"),
                rendu: (l) => <span className="mp-coupure">{l.libelle}</span>,
              },
              {
                cle: "nature",
                entete: t("Nature", "Type"),
                rendu: (l) => libelleNature(l.nature, langue),
              },
              {
                cle: "jours",
                entete: t("Jours", "Days"),
                alignement: "droite",
                rendu: (l) =>
                  l.jours === null ? t("Forfait", "Fixed fee") : formaterJours(l.jours, langue),
              },
              ...(droits.finance
                ? [
                    {
                      cle: "prix",
                      entete: t("Prix journalier", "Daily rate"),
                      alignement: "droite" as const,
                      rendu: (l: VersionBudget["lignes"][number]) =>
                        l.prix_journalier == null ? "—" : montant(l.prix_journalier),
                    },
                  ]
                : []),
              ...(droits.montants
                ? [
                    {
                      cle: "montant",
                      entete: t("Montant", "Amount"),
                      alignement: "droite" as const,
                      rendu: (l: VersionBudget["lignes"][number]) => montant(l.montant),
                    },
                  ]
                : []),
            ]}
          />
        </details>
        {!droits.finance ? (
          <p className="mp-texte-doux">
            {t(
              "Coûts internes, sous-traitance et marge sont réservés aux associés et aux gestionnaires.",
              "Internal costs, subcontracting and margin are restricted to partners and managers.",
            )}
          </p>
        ) : null}
      </div>
    </Carte>
  );
}

function ResultatComparaison({
  c,
  devise,
  t,
  langue,
}: {
  c: Comparaison;
  devise: Devise;
  t: Traduire;
  langue: Langue;
}) {
  const signe = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const jours = (n: number | null) =>
    n === null ? "—" : `${signe(n)}${formaterJours(Math.abs(n), langue)}`;
  const montant = (n: number | undefined) =>
    n === undefined ? "—" : `${signe(n)}${formaterMontantMineur(Math.abs(n), devise, langue)}`;
  return (
    <div className="mp-pile">
      <ul className="mp-totaux">
        <li className="mp-totaux__element">
          <span className="mp-totaux__libelle">
            {t("Écart de jours vendus", "Days sold variance")}
          </span>
          <span className="mp-totaux__valeur">{jours(c.ecart_jours_vendus)}</span>
        </li>
        {c.ecart_honoraires !== undefined ? (
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Écart d'honoraires", "Fee variance")}</span>
            <span className="mp-totaux__valeur">{montant(c.ecart_honoraires)}</span>
          </li>
        ) : null}
        {c.ecart_marge !== undefined ? (
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">{t("Écart de marge", "Margin variance")}</span>
            <span className="mp-totaux__valeur">{montant(c.ecart_marge)}</span>
          </li>
        ) : null}
      </ul>
      <Tableau
        legende={t(
          `Écarts ligne à ligne : V${c.avant.numero} → V${c.apres.numero}`,
          `Line-by-line variances: V${c.avant.numero} → V${c.apres.numero}`,
        )}
        legendeVisible
        lignes={c.lignes.filter((l) => l.statut !== "inchangee")}
        cleLigne={(l) => l.cle}
        messageVide={t(
          "Aucune ligne n'a changé entre ces deux versions.",
          "No line changed between these two versions.",
        )}
        colonnes={[
          {
            cle: "libelle",
            entete: t("Ligne", "Line"),
            rendu: (l) => <span className="mp-coupure">{l.libelle}</span>,
          },
          {
            cle: "nature",
            entete: t("Nature", "Type"),
            rendu: (l) => libelleNature(l.nature, langue),
          },
          {
            cle: "statut",
            entete: t("Évolution", "Change"),
            rendu: (l) => (
              <BadgeStatut tonalite={statutEcart(l.statut, langue).tonalite}>
                {statutEcart(l.statut, langue).libelle}
              </BadgeStatut>
            ),
          },
          {
            cle: "jours",
            entete: t("Écart de jours", "Days variance"),
            alignement: "droite",
            rendu: (l) => jours(l.ecart_jours),
          },
          ...(c.ecart_honoraires !== undefined
            ? [
                {
                  cle: "montant",
                  entete: t("Écart de montant", "Amount variance"),
                  alignement: "droite" as const,
                  rendu: (l: Comparaison["lignes"][number]) => montant(l.ecart_montant),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
