import type { Metadata } from "next";
import {
  FormulaireControleCv,
  FormulaireCv,
} from "../../../../../../components/banque-ao/FormulairesCv";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import {
  droitsBanqueAo,
  libelleNiveauDiplome,
  libelleNiveauLangue,
  moisAffiche,
  RACINE_BANQUES,
  saisieDepuisCv,
  type CvDetail,
  type GabaritCv,
} from "../../../../../../lib/banque-ao";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { obtenirSession } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "CV" };

/** Fiche d'un CV : version courante, historique, contrôle des exigences, export par bailleur. */
export default async function PageDetailCv({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<CvDetail>(`/api/banque-ao/cv/${encodeURIComponent(id)}`);
  const retour = { href: `${RACINE_BANQUES}/cv`, libelle: "Banque de CV" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="CV" retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/cv/${encodeURIComponent(id)}`}
          titre="Ce CV n'a pas pu être chargé."
          message={r.message}
        />
      </div>
    );
  }
  const cv = r.donnees;
  const c = cv.courante.contenu;
  const gabarits = await chargerServeur<{ elements: GabaritCv[] }>("/api/banque-ao/gabarits-cv");

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={cv.nom}
        soustitre={`${c.titre} — ${cv.annees_experience} an(s) d'expérience au ${moisAffiche(cv.reference)} (version ${cv.courante.version}).`}
        retour={retour}
      />
      <Carte titre="Expériences">
        <Tableau
          legende="Expériences"
          cleLigne={(e) => `${e.debut}-${e.intitule}`}
          lignes={c.experiences}
          messageVide="Aucune expérience."
          colonnes={[
            {
              cle: "debut",
              entete: "Période",
              rendu: (e) => `${moisAffiche(e.debut)} – ${moisAffiche(e.fin)}`,
            },
            { cle: "intitule", entete: "Poste" },
            { cle: "employeur", entete: "Employeur" },
            { cle: "pays", entete: "Pays" },
            { cle: "secteurs", entete: "Secteurs", rendu: (e) => e.secteurs.join(", ") },
            { cle: "bailleur", entete: "Bailleur" },
          ]}
        />
      </Carte>
      <Carte titre="Diplômes et langues">
        <ul>
          {c.diplomes.map((d) => (
            <li key={`${d.annee}-${d.intitule}`}>
              {d.annee} — {d.intitule} ({libelleNiveauDiplome(d.niveau)}, {d.domaine})
            </li>
          ))}
        </ul>
        <p>{c.langues.map((l) => `${l.langue} : ${libelleNiveauLangue(l.niveau)}`).join(" ; ")}</p>
        {c.secteurs.length > 0 ? <p>Secteurs : {c.secteurs.join(", ")}</p> : null}
        {c.competences.length > 0 ? <p>Compétences : {c.competences.join(", ")}</p> : null}
      </Carte>
      <Carte titre="Mise au format d'un bailleur">
        {gabarits.ok ? (
          <ul>
            {gabarits.donnees.elements.map((g) => (
              <li key={g.code}>
                {g.libelle} ({g.bailleur}) :{" "}
                <a
                  className={classesBouton("discret")}
                  href={`/api/banque-ao/cv/${encodeURIComponent(cv.id)}/export?gabarit=${g.code}&format=docx`}
                >
                  Word
                </a>{" "}
                <a
                  className={classesBouton("discret")}
                  href={`/api/banque-ao/cv/${encodeURIComponent(cv.id)}/export?gabarit=${g.code}&format=pdf`}
                >
                  PDF
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <EtatErreur
            hrefReessayer={`${RACINE_BANQUES}/cv/${encodeURIComponent(id)}`}
            titre="Gabarits indisponibles."
            message={gabarits.message}
          />
        )}
      </Carte>
      <Carte titre="Contrôler contre les exigences d'un appel d'offres">
        <FormulaireControleCv cvId={cv.id} />
      </Carte>
      <Carte titre="Historique des versions">
        <ul>
          {cv.versions.map((v) => (
            <li key={v.id}>
              Version {v.version} du {formaterDate(v.cree_le)}
              {v.motif ? ` : ${v.motif}` : " (création)"}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.gerer ? (
        <Carte titre="Nouvelle version">
          <FormulaireCv cvId={cv.id} initial={saisieDepuisCv(cv.nom, c)} />
        </Carte>
      ) : null}
    </div>
  );
}
