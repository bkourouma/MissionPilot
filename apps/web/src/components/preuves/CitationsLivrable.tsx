import Link from "next/link";
import { aPermission, type Langue, type Traduire } from "@missionpilot/shared";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import {
  ancreSource,
  formaterRenvois,
  hrefAncreSource,
  hrefOuvertureCitation,
  indexerSources,
  libelleFiabiliteSource,
  libelleSoliditeCitee,
  libelleTypeSource,
  messageVerbatimMasque,
  nomAccessibleRenvoi,
  titreSectionCitations,
  type AssertionCiteeVue,
  type LivrableCitation,
  type SourceCiteeVue,
} from "../../lib/citations";
import { chargerSourcesLivrable } from "../../lib/citations-serveur";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { TONALITE_LECTURE } from "../../lib/preuves";
import { obtenirSession } from "../../lib/session";
import "./preuves.css";

function Renvois({
  missionId,
  livrable,
  numeros,
  sources,
  prefixe,
  t,
  langue,
}: {
  missionId: string;
  livrable: LivrableCitation;
  numeros: number[];
  sources: Map<number, SourceCiteeVue>;
  prefixe?: string;
  t: Traduire;
  langue: Langue;
}) {
  if (numeros.length === 0) return null;
  return (
    <span className="mp-citation-renvois">
      {prefixe ? <span>{prefixe} </span> : null}
      {numeros.map((n, i) => {
        const s = sources.get(n);
        return (
          <span key={n}>
            {i > 0 ? ", " : ""}
            <Link
              href={
                s ? hrefOuvertureCitation(missionId, livrable, s.preuve_id) : hrefAncreSource(n)
              }
              aria-label={`${nomAccessibleRenvoi(n, s, langue)} ${t("(ouvrir la source)", "(open the source)")}`}
            >
              {formaterRenvois([n])}
            </Link>{" "}
            <a
              href={hrefAncreSource(n)}
              className="mp-citation-ancre"
              aria-label={t(
                `Aller à la source ${n} dans la liste`,
                `Go to source ${n} in the list`,
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
                aria-hidden="true"
              >
                <path d="M12 5v14M6 13l6 6 6-6" />
              </svg>
            </a>
          </span>
        );
      })}
    </span>
  );
}

function LigneAssertion({
  missionId,
  livrable,
  assertion,
  sources,
  t,
  langue,
}: {
  missionId: string;
  livrable: LivrableCitation;
  assertion: AssertionCiteeVue;
  sources: Map<number, SourceCiteeVue>;
  t: Traduire;
  langue: Langue;
}) {
  const lecture = assertion.solidite?.lecture;
  return (
    <li className="mp-citation-assertion">
      <p className="mp-citation-assertion__enonce">{assertion.enonce}</p>
      <span className="mp-preuve-ligne__meta">
        <BadgeStatut tonalite={lecture ? TONALITE_LECTURE[lecture] : "neutre"}>
          {`${t("Solidité", "Solidity")} : ${libelleSoliditeCitee(assertion.solidite, langue)}`}
        </BadgeStatut>
        {assertion.avis_expert_signe ? (
          <BadgeStatut tonalite="neutre" sansIcone>
            {t("Avis d'expert signé", "Signed expert opinion")}
          </BadgeStatut>
        ) : null}
      </span>
      {assertion.renvois.pour.length + assertion.renvois.contre.length > 0 ? (
        <p className="mp-texte-petit">
          <Renvois
            missionId={missionId}
            livrable={livrable}
            numeros={assertion.renvois.pour}
            sources={sources}
            t={t}
            langue={langue}
          />
          {assertion.renvois.pour.length > 0 && assertion.renvois.contre.length > 0 ? " · " : ""}
          <Renvois
            missionId={missionId}
            livrable={livrable}
            numeros={assertion.renvois.contre}
            sources={sources}
            prefixe={t("contre :", "against:")}
            t={t}
            langue={langue}
          />
        </p>
      ) : (
        <p className="mp-texte-doux mp-texte-petit">
          {t("Aucune source liée.", "No linked source.")}
        </p>
      )}
    </li>
  );
}

/**
 * Section « Sources et citations » d'un livrable web (PRV-06) : assertions retenues citées par le
 * livrable, avec leur solidité (moteur) et leurs renvois [n] cliquables, puis la liste numérotée
 * des sources. La numérotation est celle de l'annexe « Sources » des exports PDF et Word.
 *
 * N'affiche rien sans `preuve.lire`, sans assertion citée, ni en cas d'erreur de l'API (403, 404,
 * panne) : cette section ne casse jamais la page du livrable. Le droit est revérifié à l'ouverture
 * d'une source par l'API.
 */
export async function CitationsLivrable({
  missionId,
  livrable,
}: {
  missionId: string;
  livrable: LivrableCitation;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await obtenirSession();
  if (!aPermission(utilisateur.roles, "preuve.lire")) return null;
  const vue = await chargerSourcesLivrable(missionId, livrable);
  if (!vue || vue.assertions.length === 0) return null;
  const sources = indexerSources(vue.sources);

  return (
    <Carte
      titre={titreSectionCitations(langue)}
      niveauTitre={3}
      aria-label={titreSectionCitations(langue)}
    >
      <div className="mp-pile">
        <ul className="mp-citations-assertions">
          {vue.assertions.map((a) => (
            <LigneAssertion
              key={a.id}
              missionId={missionId}
              livrable={livrable}
              assertion={a}
              sources={sources}
              t={t}
              langue={langue}
            />
          ))}
        </ul>
        {vue.sources.length > 0 ? (
          <div>
            <h4 className="mp-citations-sous-titre">{t("Sources", "Sources")}</h4>
            <ol className="mp-citations-sources">
              {vue.sources.map((s) => (
                <li key={s.numero} id={ancreSource(s.numero)} className="mp-citation-source">
                  <p>
                    <strong>{`[${s.numero}]`}</strong>{" "}
                    <Link href={hrefOuvertureCitation(missionId, livrable, s.preuve_id)}>
                      {s.source_precise}
                    </Link>
                  </p>
                  <p className="mp-texte-doux mp-texte-petit">
                    {`${libelleTypeSource(s.type_source, langue)} · ${formaterDate(s.date_preuve, "UTC", langue)} · ${t("fiabilité", "reliability")} ${libelleFiabiliteSource(s.fiabilite, langue)}`}
                  </p>
                  {s.masque ? (
                    <p className="mp-texte-doux mp-preuve-masquee">
                      {messageVerbatimMasque(langue)}
                    </p>
                  ) : s.extrait ? (
                    <blockquote className="mp-preuve-extrait">{s.extrait}</blockquote>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Carte>
  );
}
