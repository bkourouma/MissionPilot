import type { Metadata } from "next";
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
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  aplatirArbre,
  badgeCouleur,
  formaterEcart,
  lectureIndice,
  libelleAlerte,
  libelleNoeud,
  NIVEAU_LIBELLES,
  type LigneArbre,
  type SuiviMission,
  type ValeursSuivi,
} from "../../../../../lib/suivi";

export const metadata: Metadata = { title: "Suivi de la mission" };

/** Colonnes communes : budget, réalisé, reste à faire, atterrissage, écart, état. */
function colonnesSuivi<T extends ValeursSuivi>(): ColonneTableau<T>[] {
  return [
    {
      cle: "budget",
      entete: "Budget",
      alignement: "droite",
      rendu: (l) => formaterJours(l.budget),
    },
    {
      cle: "realise",
      entete: "Réalisé",
      alignement: "droite",
      rendu: (l) => formaterJours(l.realise),
    },
    {
      cle: "reste",
      entete: "Reste à faire",
      alignement: "droite",
      rendu: (l) => formaterJours(l.reste_a_faire),
    },
    {
      cle: "atterrissage",
      entete: "Atterrissage",
      alignement: "droite",
      rendu: (l) => formaterJours(l.atterrissage),
    },
    {
      cle: "ecart",
      entete: "Écart",
      alignement: "droite",
      rendu: (l) => formaterEcart(l.ecart, l.ecart_relatif),
    },
    {
      cle: "etat",
      entete: "État",
      rendu: (l) => {
        const b = badgeCouleur(l.couleur);
        return <BadgeStatut tonalite={b.tonalite}>{b.libelle}</BadgeStatut>;
      },
    },
  ];
}

export default async function PageSuivi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await exigerPermission("budget.lire_jours");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  const r = await chargerServeur<SuiviMission>(`/api/missions/${m.donnees.id}/suivi`);
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Le suivi de la mission n'a pas pu être calculé."
        message={r.message}
        hrefReessayer={`/missions/${id}/suivi`}
      />
    );
  }
  const s = r.donnees;
  const a = s.arbre;
  const total = badgeCouleur(a.couleur);
  const lignes = aplatirArbre(a);

  return (
    <div className="mp-pile mp-pile--large">
      {s.alertes.length > 0 ? (
        <Alerte
          tonalite="danger"
          titre={`${s.alertes.length} alerte(s) active(s)`}
          annonce="aucune"
        >
          <ul className="mp-liste-simple">
            {s.alertes.map((x) => (
              <li key={`${x.noeud_id}-${x.type}`}>
                <strong>{libelleNoeud(a, x.noeud_id)}</strong>
                {` : ${x.message || libelleAlerte(x)} (depuis le ${formaterDateHeure(x.declenchee_le)})`}
              </li>
            ))}
          </ul>
        </Alerte>
      ) : null}

      <Carte
        titre="Synthèse de la mission"
        actions={<BadgeStatut tonalite={total.tonalite}>{total.libelle}</BadgeStatut>}
      >
        <div className="mp-pile">
          <ul className="mp-totaux">
            {[
              ["Budget", formaterJours(a.budget)],
              ["Réalisé (validé)", formaterJours(a.realise)],
              ["Reste à faire", formaterJours(a.reste_a_faire)],
              ["Atterrissage", formaterJours(a.atterrissage)],
              ["Écart", formaterEcart(a.ecart, a.ecart_relatif)],
              ["Consommation du budget", formaterPourcentage(a.consommation)],
            ].map(([libelle, valeur]) => (
              <li key={libelle} className="mp-totaux__element">
                <span className="mp-totaux__libelle">{libelle}</span>
                <span className="mp-totaux__valeur">{valeur}</span>
              </li>
            ))}
          </ul>
          {s.en_attente > 0 ? (
            <p className="mp-texte-doux">
              {`${formaterJours(s.en_attente)} saisis attendent une validation : ils ne comptent pas encore dans le réalisé.`}
            </p>
          ) : null}
          <p className="mp-texte-doux">
            {`Atterrissage = réalisé + reste à faire ; écart = atterrissage \u2212 budget. « À surveiller » : réalisé à partir de ${s.seuils.consommation_orange_pct} % du budget, ou atterrissage au-delà de ${s.seuils.atterrissage_orange_pct} % ; « Dépassement » : atterrissage au-delà de ${s.seuils.atterrissage_rouge_pct} % du budget.`}
          </p>
        </div>
      </Carte>

      <Carte titre="Avancement physique">
        {s.performance === null ? (
          <p className="mp-texte-doux">
            Aucun jalon ni livrable : l&apos;avancement physique n&apos;est pas mesurable. Ajoutez
            des jalons ou marquez des tâches livrables dans le découpage.
          </p>
        ) : (
          <div className="mp-pile">
            <ul className="mp-totaux">
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">{`Avancement (${s.performance.elements} jalons et livrables)`}</span>
                <span className="mp-totaux__valeur">
                  {formaterPourcentage(s.performance.avancement)}
                </span>
              </li>
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">Consommation</span>
                <span className="mp-totaux__valeur">
                  {formaterPourcentage(s.performance.consommation)}
                </span>
              </li>
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">Indice de performance</span>
                <span className="mp-totaux__valeur">{formaterNombre(s.performance.indice, 2)}</span>
              </li>
            </ul>
            <p>
              <BadgeStatut tonalite={lectureIndice(s.performance.indice).tonalite}>
                {lectureIndice(s.performance.indice).libelle}
              </BadgeStatut>
            </p>
          </div>
        )}
      </Carte>

      <Carte titre="Par phase, lot et tâche">
        {lignes.length === 0 ? (
          <EtatVide titre="Aucune phase dans le découpage." icone="dossier" />
        ) : (
          <Tableau<LigneArbre & ValeursSuivi>
            legende="Budget, réalisé, reste à faire et atterrissage par phase, lot et tâche"
            lignes={[
              ...lignes.map((l) => ({ ...l, ...l.noeud })),
              { noeud: a, profondeur: -1, ...a },
            ]}
            cleLigne={(l) => `${l.noeud.niveau}-${l.noeud.id}`}
            colonnes={[
              {
                cle: "element",
                entete: "Élément",
                rendu: (l) =>
                  l.profondeur < 0 ? (
                    <strong>Total de la mission</strong>
                  ) : (
                    <span className={`mp-suivi__niveau mp-suivi__niveau--${l.profondeur}`}>
                      <span className="mp-visuellement-cache">{`${NIVEAU_LIBELLES[l.noeud.niveau]} : `}</span>
                      {l.noeud.niveau === "phase" ? (
                        <strong>{l.noeud.libelle}</strong>
                      ) : (
                        l.noeud.libelle
                      )}
                      {l.noeud.reste_a_faire_estime ? (
                        <span className="mp-texte-doux mp-texte-petit"> (reste estimé)</span>
                      ) : null}
                    </span>
                  ),
              },
              ...colonnesSuivi<LigneArbre & ValeursSuivi>(),
              {
                cle: "attente",
                entete: "En attente",
                alignement: "droite",
                rendu: (l) => (l.noeud.en_attente > 0 ? formaterJours(l.noeud.en_attente) : "—"),
              },
            ]}
          />
        )}
        <p className="mp-texte-doux">
          « Reste estimé » : aucune déclaration sur la tâche, le reste à faire vaut budget moins
          réalisé.
        </p>
      </Carte>

      <Carte titre="Par personne">
        <Tableau
          legende="Suivi par personne (reste à faire déclaré uniquement)"
          lignes={s.par_personne}
          cleLigne={(l) => l.collaborateur_id}
          messageVide="Aucun temps ni budget nominatif pour l'instant."
          colonnes={[
            {
              cle: "nom",
              entete: "Personne",
              rendu: (l) =>
                `${l.nom ?? "Collaborateur"}${l.grade_code ? ` (${l.grade_code})` : ""}`,
            },
            ...colonnesSuivi<SuiviMission["par_personne"][number]>(),
          ]}
        />
      </Carte>

      <Carte titre="Par grade">
        <Tableau
          legende="Suivi par grade"
          lignes={s.par_grade}
          cleLigne={(l) => l.grade_id ?? "sans-grade"}
          messageVide="Aucun budget par grade."
          colonnes={[
            { cle: "grade", entete: "Grade", rendu: (l) => l.grade_libelle },
            ...colonnesSuivi<SuiviMission["par_grade"][number]>(),
          ]}
        />
      </Carte>
    </div>
  );
}
