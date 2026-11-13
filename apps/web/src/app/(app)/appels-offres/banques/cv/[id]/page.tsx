import type { Metadata } from "next";
import { AnonymisationCv } from "../../../../../../components/banque-ao/AnonymisationCv";
import {
  FormulaireControleCv,
  FormulaireCv,
} from "../../../../../../components/banque-ao/FormulairesCv";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Alerte } from "../../../../../../components/ui/Alerte";
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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("CV", "CV") };
}

/** Fiche d'un CV : version courante, historique, contrôle des exigences, export par bailleur. */
export default async function PageDetailCv({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsBanqueAo(utilisateur.roles);
  const r = await chargerServeur<CvDetail>(`/api/banque-ao/cv/${encodeURIComponent(id)}`);
  const retour = { href: `${RACINE_BANQUES}/cv`, libelle: t("Banque de CV", "CV bank") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="CV" retour={retour} />
        <EtatErreur
          hrefReessayer={`${RACINE_BANQUES}/cv/${encodeURIComponent(id)}`}
          titre={t("Ce CV n'a pas pu être chargé.", "This CV could not be loaded.")}
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
        soustitre={t(
          `${c.titre} — ${cv.annees_experience} an(s) d'expérience au ${moisAffiche(cv.reference)} (version ${cv.courante.version}).`,
          `${c.titre} — ${cv.annees_experience} year(s) of experience as of ${moisAffiche(cv.reference, langue)} (version ${cv.courante.version}).`,
        )}
        retour={retour}
      />
      {cv.anonymise ? (
        <Alerte tonalite="info" titre={t("CV anonymisé", "CV anonymized")} annonce="aucune">
          <p>
            {t(
              "Le parcours de cette personne a été effacé de façon irréversible : ce CV n'est plus exportable, ne reçoit plus de nouvelle version et ne peut plus entrer dans une offre.",
              "This person's background was irreversibly erased: this CV can no longer be exported, receives no new version and cannot enter a bid.",
            )}
          </p>
        </Alerte>
      ) : null}
      <Carte titre={t("Expériences", "Experience")}>
        <Tableau
          legende={t("Expériences", "Experience")}
          cleLigne={(e) => `${e.debut}-${e.intitule}`}
          lignes={c.experiences}
          messageVide={t("Aucune expérience.", "No experience.")}
          colonnes={[
            {
              cle: "debut",
              entete: t("Période", "Period"),
              rendu: (e) => `${moisAffiche(e.debut, langue)} – ${moisAffiche(e.fin, langue)}`,
            },
            { cle: "intitule", entete: t("Poste", "Position") },
            { cle: "employeur", entete: t("Employeur", "Employer") },
            { cle: "pays", entete: t("Pays", "Country") },
            {
              cle: "secteurs",
              entete: t("Secteurs", "Sectors"),
              rendu: (e) => e.secteurs.join(", "),
            },
            { cle: "bailleur", entete: t("Bailleur", "Donor") },
          ]}
        />
      </Carte>
      <Carte titre={t("Diplômes et langues", "Degrees and languages")}>
        <ul>
          {c.diplomes.map((d) => (
            <li key={`${d.annee}-${d.intitule}`}>
              {d.annee} — {d.intitule} ({libelleNiveauDiplome(d.niveau, langue)}, {d.domaine})
            </li>
          ))}
        </ul>
        <p>
          {c.langues
            .map((l) => `${l.langue}${t(" : ", ": ")}${libelleNiveauLangue(l.niveau, langue)}`)
            .join(" ; ")}
        </p>
        {c.secteurs.length > 0 ? (
          <p>
            {t("Secteurs :", "Sectors:")} {c.secteurs.join(", ")}
          </p>
        ) : null}
        {c.competences.length > 0 ? (
          <p>
            {t("Compétences :", "Skills:")} {c.competences.join(", ")}
          </p>
        ) : null}
      </Carte>
      {cv.anonymise ? null : (
        <Carte titre={t("Mise au format d'un bailleur", "Format for a donor")}>
          {gabarits.ok ? (
            <ul>
              {gabarits.donnees.elements.map((g) => (
                <li key={g.code}>
                  {g.libelle} ({g.bailleur}){t(" :", ":")}{" "}
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
              titre={t("Gabarits indisponibles.", "Templates unavailable.")}
              message={gabarits.message}
            />
          )}
        </Carte>
      )}
      <Carte
        titre={t(
          "Contrôler contre les exigences d'un appel d'offres",
          "Check against a tender's requirements",
        )}
      >
        <FormulaireControleCv cvId={cv.id} />
      </Carte>
      <Carte titre={t("Historique des versions", "Version history")}>
        <ul>
          {cv.versions.map((v) => (
            <li key={v.id}>
              {t(
                `Version ${v.version} du ${formaterDate(v.cree_le)}`,
                `Version ${v.version} of ${formaterDate(v.cree_le, "UTC", langue)}`,
              )}
              {v.motif ? ` : ${v.motif}` : t(" (création)", " (creation)")}
            </li>
          ))}
        </ul>
      </Carte>
      {droits.gerer && !cv.anonymise ? (
        <Carte titre={t("Nouvelle version", "New version")}>
          <FormulaireCv cvId={cv.id} initial={saisieDepuisCv(cv.nom, c)} />
        </Carte>
      ) : null}
      {droits.anonymiser ? (
        <Carte titre={t("Anonymiser ce CV", "Anonymize this CV")}>
          <AnonymisationCv cvId={cv.id} anonymise={cv.anonymise} />
        </Carte>
      ) : null}
    </div>
  );
}
