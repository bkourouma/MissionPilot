import type { Metadata } from "next";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  formaterDateHeure,
  formaterJours,
  formaterNombre,
  formaterPourcentage,
} from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  aplatirArbre,
  badgeCouleur,
  formaterEcart,
  lectureIndice,
  libelleAlerte,
  libelleNiveau,
  libelleNoeud,
  type LigneArbre,
  type SuiviMission,
  type ValeursSuivi,
} from "../../../../../lib/suivi";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Suivi de la mission", "Engagement tracking") };
}

/** Colonnes communes : budget, réalisé, reste à faire, atterrissage, écart, état. */
function colonnesSuivi<T extends ValeursSuivi>(langue: Langue): ColonneTableau<T>[] {
  const t = creerTraduire(langue);
  return [
    {
      cle: "budget",
      entete: t("Budget", "Budget"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.budget, langue),
    },
    {
      cle: "realise",
      entete: t("Réalisé", "Actual"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.realise, langue),
    },
    {
      cle: "reste",
      entete: t("Reste à faire", "Remaining"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.reste_a_faire, langue),
    },
    {
      cle: "atterrissage",
      entete: t("Atterrissage", "Landing"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.atterrissage, langue),
    },
    {
      cle: "ecart",
      entete: t("Écart", "Variance"),
      alignement: "droite",
      rendu: (l) => formaterEcart(l.ecart, l.ecart_relatif, langue),
    },
    {
      cle: "etat",
      entete: t("État", "Status"),
      rendu: (l) => {
        const b = badgeCouleur(l.couleur, langue);
        return <BadgeStatut tonalite={b.tonalite}>{b.libelle}</BadgeStatut>;
      },
    },
  ];
}

export default async function PageSuivi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  await exigerPermission("budget.lire_jours");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  const r = await chargerServeur<SuiviMission>(`/api/missions/${m.donnees.id}/suivi`);
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Le suivi de la mission n'a pas pu être calculé.",
          "The engagement tracking could not be computed.",
        )}
        message={r.message}
        hrefReessayer={`/missions/${id}/suivi`}
      />
    );
  }
  const s = r.donnees;
  const a = s.arbre;
  const total = badgeCouleur(a.couleur, langue);
  const lignes = aplatirArbre(a);

  return (
    <div className="mp-pile mp-pile--large">
      {s.alertes.length > 0 ? (
        <Alerte
          tonalite="danger"
          titre={t(
            `${s.alertes.length} alerte(s) active(s)`,
            `${s.alertes.length} active alert(s)`,
          )}
          annonce="aucune"
        >
          <ul className="mp-liste-simple">
            {s.alertes.map((x) => (
              <li key={`${x.noeud_id}-${x.type}`}>
                <strong>{libelleNoeud(a, x.noeud_id, langue)}</strong>
                {` : ${x.message || libelleAlerte(x, langue)} (${t("depuis le", "since")} ${formaterDateHeure(x.declenchee_le, undefined, langue)})`}
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}

      <Carte
        titre={t("Synthèse de la mission", "Engagement summary")}
        actions={<BadgeStatut tonalite={total.tonalite}>{total.libelle}</BadgeStatut>}
      >
        <div className="mp-pile">
          <ul className="mp-totaux">
            {[
              [t("Budget", "Budget"), formaterJours(a.budget, langue)],
              [t("Réalisé (validé)", "Actual (approved)"), formaterJours(a.realise, langue)],
              [t("Reste à faire", "Remaining"), formaterJours(a.reste_a_faire, langue)],
              [t("Atterrissage", "Landing"), formaterJours(a.atterrissage, langue)],
              [t("Écart", "Variance"), formaterEcart(a.ecart, a.ecart_relatif, langue)],
              [
                t("Consommation du budget", "Budget consumption"),
                formaterPourcentage(a.consommation, 1, langue),
              ],
            ].map(([libelle, valeur]) => (
              <li key={libelle} className="mp-totaux__element">
                <span className="mp-totaux__libelle">{libelle}</span>
                <span className="mp-totaux__valeur">{valeur}</span>
              </li>
            ))}
          </ul>
          {s.en_attente > 0 ? (
            <p className="mp-texte-doux">
              {t(
                `${formaterJours(s.en_attente)} saisis attendent une validation : ils ne comptent pas encore dans le réalisé.`,
                `${formaterJours(s.en_attente, "en")} entered are awaiting approval: they do not count in the actual yet.`,
              )}
            </p>
          ) : null}
          <p className="mp-texte-doux">
            {t(
              `Atterrissage = réalisé + reste à faire ; écart = atterrissage − budget. « À surveiller » : réalisé à partir de ${s.seuils.consommation_orange_pct} % du budget, ou atterrissage au-delà de ${s.seuils.atterrissage_orange_pct} % ; « Dépassement » : atterrissage au-delà de ${s.seuils.atterrissage_rouge_pct} % du budget.`,
              `Landing = actual + remaining; variance = landing − budget. “Watch”: actual at or above ${s.seuils.consommation_orange_pct}% of the budget, or landing beyond ${s.seuils.atterrissage_orange_pct}%; “Overrun”: landing beyond ${s.seuils.atterrissage_rouge_pct}% of the budget.`,
            )}
          </p>
        </div>
      </Carte>

      <Carte titre={t("Avancement physique", "Physical progress")}>
        {s.performance === null ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun jalon ni livrable : l'avancement physique n'est pas mesurable. Ajoutez des jalons ou marquez des tâches livrables dans le découpage.",
              "No milestone or deliverable: physical progress cannot be measured. Add milestones or mark tasks as deliverables in the work breakdown.",
            )}
          </p>
        ) : (
          <div className="mp-pile">
            <ul className="mp-totaux">
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">
                  {t(
                    `Avancement (${s.performance.elements} jalons et livrables)`,
                    `Progress (${s.performance.elements} milestones and deliverables)`,
                  )}
                </span>
                <span className="mp-totaux__valeur">
                  {formaterPourcentage(s.performance.avancement, 1, langue)}
                </span>
              </li>
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">{t("Consommation", "Consumption")}</span>
                <span className="mp-totaux__valeur">
                  {formaterPourcentage(s.performance.consommation, 1, langue)}
                </span>
              </li>
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">
                  {t("Indice de performance", "Performance index")}
                </span>
                <span className="mp-totaux__valeur">
                  {formaterNombre(s.performance.indice, 2, langue)}
                </span>
              </li>
            </ul>
            <p>
              <BadgeStatut tonalite={lectureIndice(s.performance.indice, langue).tonalite}>
                {lectureIndice(s.performance.indice, langue).libelle}
              </BadgeStatut>
            </p>
          </div>
        )}
      </Carte>

      <Carte titre={t("Par phase, lot et tâche", "By phase, work package and task")}>
        {lignes.length === 0 ? (
          <EtatVide
            titre={t("Aucune phase dans le découpage.", "No phase in the work breakdown.")}
            icone="dossier"
          />
        ) : (
          <Tableau<LigneArbre & ValeursSuivi>
            legende={t(
              "Budget, réalisé, reste à faire et atterrissage par phase, lot et tâche",
              "Budget, actual, remaining work and landing by phase, work package and task",
            )}
            lignes={[
              ...lignes.map((l) => ({ ...l, ...l.noeud })),
              { noeud: a, profondeur: -1, ...a },
            ]}
            cleLigne={(l) => `${l.noeud.niveau}-${l.noeud.id}`}
            colonnes={[
              {
                cle: "element",
                entete: t("Élément", "Item"),
                rendu: (l) =>
                  l.profondeur < 0 ? (
                    <strong>{t("Total de la mission", "Engagement total")}</strong>
                  ) : (
                    <span className={`mp-suivi__niveau mp-suivi__niveau--${l.profondeur}`}>
                      <span className="mp-visuellement-cache">{`${libelleNiveau(l.noeud.niveau, langue)}${t(" : ", ": ")}`}</span>
                      {l.noeud.niveau === "phase" ? (
                        <strong>{l.noeud.libelle}</strong>
                      ) : (
                        l.noeud.libelle
                      )}
                      {l.noeud.reste_a_faire_estime ? (
                        <span className="mp-texte-doux mp-texte-petit">
                          {t(" (reste estimé)", " (estimated remaining)")}
                        </span>
                      ) : null}
                    </span>
                  ),
              },
              ...colonnesSuivi<LigneArbre & ValeursSuivi>(langue),
              {
                cle: "attente",
                entete: t("En attente", "Pending"),
                alignement: "droite",
                rendu: (l) =>
                  l.noeud.en_attente > 0 ? formaterJours(l.noeud.en_attente, langue) : "—",
              },
            ]}
          />
        )}
        <p className="mp-texte-doux">
          {t(
            "« Reste estimé » : aucune déclaration sur la tâche, le reste à faire vaut budget moins réalisé.",
            "“Estimated remaining”: no declaration on the task, the remaining work equals budget minus actual.",
          )}
        </p>
      </Carte>

      <Carte titre={t("Par personne", "By person")}>
        <Tableau
          legende={t(
            "Suivi par personne (reste à faire déclaré uniquement)",
            "Tracking by person (declared remaining work only)",
          )}
          lignes={s.par_personne}
          cleLigne={(l) => l.collaborateur_id}
          messageVide={t(
            "Aucun temps ni budget nominatif pour l'instant.",
            "No named time or budget yet.",
          )}
          colonnes={[
            {
              cle: "nom",
              entete: t("Personne", "Person"),
              rendu: (l) =>
                `${l.nom ?? t("Collaborateur", "Team member")}${l.grade_code ? ` (${l.grade_code})` : ""}`,
            },
            ...colonnesSuivi<SuiviMission["par_personne"][number]>(langue),
          ]}
        />
      </Carte>

      <Carte titre={t("Par grade", "By grade")}>
        <Tableau
          legende={t("Suivi par grade", "Tracking by grade")}
          lignes={s.par_grade}
          cleLigne={(l) => l.grade_id ?? "sans-grade"}
          messageVide={t("Aucun budget par grade.", "No budget by grade.")}
          colonnes={[
            { cle: "grade", entete: t("Grade", "Grade"), rendu: (l) => l.grade_libelle },
            ...colonnesSuivi<SuiviMission["par_grade"][number]>(langue),
          ]}
        />
      </Carte>
    </div>
  );
}
