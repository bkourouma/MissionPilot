import type { Metadata } from "next";
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
  NATURE_LIBELLES,
  STATUT_ECART,
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
} from "../../../../../lib/format";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { ActionsBudget } from "./ActionsBudget";

export const metadata: Metadata = { title: "Budget de la mission" };

export default async function PageBudget({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
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
        titre="Le budget n'a pas pu être chargé."
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
    { statut: m.statut, modifiable: droitsMission(m, roles, utilisateur.id).responsable },
    budget,
    {
      utilisateurId: utilisateur.id,
      directeurId: m.directeur_id,
      auteurEnCours: enCours?.cree_par ?? null,
    },
  );
  const versions = [...budget.versions].reverse();
  const options = budget.versions.map((v) => ({ valeur: v.id, libelle: libelleVersion(v) }));

  return (
    <div className="mp-pile mp-pile--large">
      {budget.versions.length === 0 ? (
        <EtatVide titre="Pas encore de budget signé." icone="cadenas">
          <p>
            Le budget initial est calculé depuis le découpage et figé à la signature de la lettre de
            mission (onglet Fiche).
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre="Versions de budget">
            <div className="mp-pile">
              <p className="mp-texte-doux">
                {`Devise : ${budget.devise}.`}
                {budget.taux_change !== null &&
                budget.devise_reference &&
                budget.devise_reference !== budget.devise
                  ? ` Taux figé à la signature : 1 ${budget.devise} = ${formaterNombre(budget.taux_change, 6)} ${budget.devise_reference}.`
                  : ""}{" "}
                L&apos;initial signé reste dans l&apos;historique ; chaque révision validée devient
                la référence.
              </p>
              <ActionsBudget
                missionId={m.id}
                actions={actions}
                enCoursId={budget.en_cours_id}
                enCoursLibelle={enCours ? libelleVersion(enCours) : null}
              />
            </div>
          </Carte>

          {versions.map((v) => (
            <CarteVersion
              key={v.id}
              version={v}
              referenceId={budget.reference_id}
              droits={droits}
            />
          ))}

          {budget.versions.length >= 2 ? (
            <Carte titre="Comparer deux versions">
              <div className="mp-pile">
                <form
                  method="get"
                  className="mp-filtres"
                  aria-label="Choisir les versions à comparer"
                >
                  <div className="mp-grille-champs mp-grille-champs--filtres">
                    <Select
                      libelle="Version de départ"
                      name="avant"
                      options={options}
                      defaultValue={choix?.avant ?? budget.versions[0]?.id}
                    />
                    <Select
                      libelle="Version comparée"
                      name="apres"
                      options={options}
                      defaultValue={choix?.apres ?? budget.versions.at(-1)?.id}
                    />
                  </div>
                  <div className="mp-actions-formulaire">
                    <button type="submit" className={classesBouton("secondaire")}>
                      <Icone nom="barres" />
                      <span>Comparer</span>
                    </button>
                  </div>
                </form>
                {comparaison ? (
                  comparaison.ok ? (
                    <ResultatComparaison
                      c={comparaisonVisible(comparaison.donnees, droits)}
                      devise={budget.devise}
                    />
                  ) : (
                    <EtatErreur
                      titre="La comparaison n'a pas pu être calculée."
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
}: {
  version: VersionBudget;
  referenceId: string | null;
  droits: DroitsBudget;
}) {
  const etat = etatVersion(v, referenceId, v.id);
  const s = v.synthese;
  const devise = v.devise as Devise;
  const montant = (x: number | undefined) => formaterMontantMineur(x, devise);
  return (
    <Carte
      titre={libelleVersion(v)}
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
              <dt>Motif</dt>
              <dd className="mp-texte-preserve">{v.motif}</dd>
            </div>
          ) : null}
          <div>
            <dt>{v.figee ? "Figée le" : "Créée le"}</dt>
            <dd>{v.figee ? formaterDate(v.date_figeage) : formaterDateHeure(v.cree_le)}</dd>
          </div>
          <div>
            <dt>Jours vendus</dt>
            <dd>{formaterJours(s.jours_vendus)}</dd>
          </div>
          {droits.montants && s.honoraires !== undefined ? (
            <>
              <div>
                <dt>Honoraires</dt>
                <dd>{montant(s.honoraires)}</dd>
              </div>
              <div>
                <dt>Débours refacturables</dt>
                <dd>{montant(s.debours_refacturables)}</dd>
              </div>
              <div>
                <dt>Débours non refacturables</dt>
                <dd>{montant(s.debours_non_refacturables)}</dd>
              </div>
            </>
          ) : null}
          {droits.finance && s.marge !== undefined ? (
            <>
              <div>
                <dt>Coûts internes</dt>
                <dd>{montant(s.couts_internes)}</dd>
              </div>
              <div>
                <dt>Sous-traitance</dt>
                <dd>{montant(s.sous_traitance)}</dd>
              </div>
              <div>
                <dt>Marge</dt>
                <dd>
                  {`${montant(s.marge)} (${formaterPourcentage(s.taux_marge ?? null)})`}{" "}
                  <span className="mp-mention-confidentielle">Confidentiel</span>
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        <details className="mp-details">
          <summary>{`Lignes du budget (${formaterNombre(v.lignes.length, 0)})`}</summary>
          <Tableau
            legende={`Lignes de ${libelleVersion(v)}`}
            lignes={v.lignes}
            cleLigne={(l) => l.id}
            messageVide="Aucune ligne visible."
            colonnes={[
              {
                cle: "libelle",
                entete: "Ligne",
                rendu: (l) => <span className="mp-coupure">{l.libelle}</span>,
              },
              { cle: "nature", entete: "Nature", rendu: (l) => NATURE_LIBELLES[l.nature] },
              {
                cle: "jours",
                entete: "Jours",
                alignement: "droite",
                rendu: (l) => (l.jours === null ? "Forfait" : formaterJours(l.jours)),
              },
              ...(droits.finance
                ? [
                    {
                      cle: "prix",
                      entete: "Prix journalier",
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
                      entete: "Montant",
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
            Coûts internes, sous-traitance et marge sont réservés aux associés et aux gestionnaires.
          </p>
        ) : null}
      </div>
    </Carte>
  );
}

function ResultatComparaison({ c, devise }: { c: Comparaison; devise: Devise }) {
  const signe = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  const jours = (n: number | null) =>
    n === null ? "—" : `${signe(n)}${formaterJours(Math.abs(n))}`;
  const montant = (n: number | undefined) =>
    n === undefined ? "—" : `${signe(n)}${formaterMontantMineur(Math.abs(n), devise)}`;
  return (
    <div className="mp-pile">
      <ul className="mp-totaux">
        <li className="mp-totaux__element">
          <span className="mp-totaux__libelle">Écart de jours vendus</span>
          <span className="mp-totaux__valeur">{jours(c.ecart_jours_vendus)}</span>
        </li>
        {c.ecart_honoraires !== undefined ? (
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Écart d&apos;honoraires</span>
            <span className="mp-totaux__valeur">{montant(c.ecart_honoraires)}</span>
          </li>
        ) : null}
        {c.ecart_marge !== undefined ? (
          <li className="mp-totaux__element">
            <span className="mp-totaux__libelle">Écart de marge</span>
            <span className="mp-totaux__valeur">{montant(c.ecart_marge)}</span>
          </li>
        ) : null}
      </ul>
      <Tableau
        legende={`Écarts ligne à ligne : V${c.avant.numero} → V${c.apres.numero}`}
        legendeVisible
        lignes={c.lignes.filter((l) => l.statut !== "inchangee")}
        cleLigne={(l) => l.cle}
        messageVide="Aucune ligne n'a changé entre ces deux versions."
        colonnes={[
          {
            cle: "libelle",
            entete: "Ligne",
            rendu: (l) => <span className="mp-coupure">{l.libelle}</span>,
          },
          { cle: "nature", entete: "Nature", rendu: (l) => NATURE_LIBELLES[l.nature] },
          {
            cle: "statut",
            entete: "Évolution",
            rendu: (l) => (
              <BadgeStatut tonalite={STATUT_ECART[l.statut].tonalite}>
                {STATUT_ECART[l.statut].libelle}
              </BadgeStatut>
            ),
          },
          {
            cle: "jours",
            entete: "Écart de jours",
            alignement: "droite",
            rendu: (l) => jours(l.ecart_jours),
          },
          ...(c.ecart_honoraires !== undefined
            ? [
                {
                  cle: "montant",
                  entete: "Écart de montant",
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
