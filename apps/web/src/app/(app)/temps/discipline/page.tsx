import type { Metadata } from "next";
import { BadgeStatut, type TonaliteStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterPourcentage } from "../../../../lib/format";
import { libelleDateCourte } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Discipline de saisie" };

interface Ratio {
  reussis: number;
  attendus: number;
  taux: number | null;
}

interface Discipline {
  debut: string;
  fin: string;
  date_reference: string;
  total: Ratio;
  elements: (Ratio & {
    collaborateur: { id: string; nom: string };
    semaines: { semaine: string; date_limite: string; statut: string; soumise_le: string | null }[];
  })[];
  curseur_suivant: string | null;
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

const ETAT_SEMAINE: Record<string, { libelle: string; tonalite: TonaliteStatut }> = {
  absente: { libelle: "Non soumise", tonalite: "danger" },
  brouillon: { libelle: "Brouillon", tonalite: "attention" },
  soumise: { libelle: "Soumise", tonalite: "succes" },
  validee: { libelle: "Validée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "attention" },
  verrouillee: { libelle: "Verrouillée", tonalite: "succes" },
};

/** Indicateur « Discipline de saisie » : feuilles soumises dans les délais / attendues. */
export default async function PageDiscipline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("temps.saisir");
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const r = await chargerServeur<Discipline>(
    `/api/temps/discipline?limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  const ratio = (x: Ratio) =>
    x.taux === null
      ? "Rien d'attendu"
      : `${formaterPourcentage(x.taux)} (${x.reussis} sur ${x.attendus})`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Discipline de saisie"
        soustitre="Feuilles soumises dans les délais (au plus tard le dimanche de la semaine) sur les feuilles attendues, quatre dernières semaines. Votre équipe si vous validez des temps, tout le cabinet pour la direction."
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'indicateur n'a pas pu être calculé."
          message={r.message}
          hrefReessayer="/temps/discipline"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune feuille attendue sur la période." icone="horloge" />
      ) : (
        <>
          <ul className="mp-totaux">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{`Ensemble, du ${formaterDate(r.donnees.debut)} au ${formaterDate(r.donnees.fin)}`}</span>
              <span className="mp-totaux__valeur">{ratio(r.donnees.total)}</span>
            </li>
          </ul>
          <Tableau
            legende="Discipline de saisie par collaborateur"
            lignes={r.donnees.elements}
            cleLigne={(e) => e.collaborateur.id}
            colonnes={[
              { cle: "nom", entete: "Collaborateur", rendu: (e) => e.collaborateur.nom },
              { cle: "ratio", entete: "Dans les délais", alignement: "droite", rendu: ratio },
              {
                cle: "semaines",
                entete: "Semaines",
                rendu: (e) => (
                  <ul className="mp-badges">
                    {e.semaines.map((s) => {
                      const enCours =
                        (s.statut === "absente" || s.statut === "brouillon") &&
                        s.date_limite >= r.donnees.date_reference;
                      const etat = enCours
                        ? { libelle: "À soumettre d'ici dimanche", tonalite: "neutre" as const }
                        : (ETAT_SEMAINE[s.statut] ?? {
                            libelle: s.statut,
                            tonalite: "neutre" as const,
                          });
                      return (
                        <li key={s.semaine}>
                          <BadgeStatut tonalite={etat.tonalite}>
                            {`${libelleDateCourte(s.semaine)} : ${etat.libelle}`}
                          </BadgeStatut>
                        </li>
                      );
                    })}
                  </ul>
                ),
              },
            ]}
          />
          <PaginationCurseur
            libelle="Pages de collaborateurs"
            hrefSuivante={
              r.donnees.curseur_suivant
                ? `/temps/discipline?curseur=${encodeURIComponent(r.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? "/temps/discipline" : null}
          />
        </>
      )}
    </div>
  );
}
