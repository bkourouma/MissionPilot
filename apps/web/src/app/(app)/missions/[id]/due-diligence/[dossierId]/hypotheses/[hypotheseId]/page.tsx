import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeVerdict } from "../../../../../../../../components/due-diligence/BadgesDd";
import { CorrectionHypothese } from "../../../../../../../../components/due-diligence/FormulairesHypothese";
import { FormulaireVerdict } from "../../../../../../../../components/due-diligence/FormulaireVerdict";
import { LiensHypothese } from "../../../../../../../../components/due-diligence/LiensHypothese";
import { ValidationDecision } from "../../../../../../../../components/due-diligence/ValidationDecision";
import { Alerte } from "../../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../../lib/api-serveur";
import {
  cheminHypotheses,
  cheminValidationVerdict,
  cheminVerdictsHypothese,
  droitsDd,
  etatVerdict,
  hrefEcranDossier,
  hrefHypothese,
  libelleRaisonVerdict,
  libellesDd,
  peutSignerAvisDd,
  messageAuteurVerdict,
  peutValiderSansConflit,
  type ReponseHypotheses,
  type VerdictDetail,
} from "../../../../../../../../lib/due-diligence";
import { chargerAssertionsMission } from "../../../../../../../../lib/due-diligence-serveur";
import { formaterDateHeure } from "../../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Hypothèse", "Hypothesis") };
}

/**
 * Une hypothèse (DD-09) : assertions liées (soutient ou contredit) avec leur solidité, indication
 * du moteur, proposition de verdict et historique des verdicts. La validation revient à une autre
 * personne que le proposant ; l'API juge et son refus s'affiche avec son message précis.
 */
export default async function PageHypotheseDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string; hypotheseId: string }>;
}) {
  const { id, dossierId, hypotheseId } = await params;
  if (!estIdentifiant(hypotheseId)) notFound();
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const [arbre, verdicts, assertions] = await Promise.all([
    chargerServeur<ReponseHypotheses>(cheminHypotheses(dossierId)),
    chargerServeur<{ elements: VerdictDetail[] }>(cheminVerdictsHypothese(hypotheseId)),
    droits.ecrire ? chargerAssertionsMission(id) : Promise.resolve(null),
  ]);
  if (!arbre.ok) {
    return (
      <EtatErreur
        titre={t("L'hypothèse n'a pas pu être chargée.", "The hypothesis could not be loaded.")}
        message={arbre.message}
        hrefReessayer={hrefHypothese(id, dossierId, hypotheseId)}
      />
    );
  }
  const h = arbre.donnees.noeuds.find((n) => n.id === hypotheseId);
  if (!h) notFound();
  const etat = etatVerdict(h);
  const liees = new Set(h.liens.map((l) => l.assertion_id));
  const disponibles =
    assertions && assertions.ok
      ? assertions.donnees
          .filter((a) => !liees.has(a.id))
          .map((a) => ({ valeur: a.id, libelle: a.enonce }))
      : [];
  const citables = h.liens.map((l) => ({
    valeur: l.assertion_id,
    libelle: `${l.enonce.length > 110 ? `${l.enonce.slice(0, 109)}…` : l.enonce} (${L.SENS_LIEN[l.sens].toLowerCase()})`,
  }));
  const historique = verdicts.ok
    ? [...verdicts.donnees.elements].sort((a, b) => Number(b.numero) - Number(a.numero))
    : [];
  const peutRetirer = h.verdict_en_attente === null;
  const indic = t("Indication du moteur", "Engine indication");
  const lecturesTexte = (c: { solide: number; etayee: number; fragile: number }) =>
    t(
      `${c.solide} solide(s), ${c.etayee} étayé(s), ${c.fragile} fragile(s)`,
      `${c.solide} strong, ${c.etayee} supported, ${c.fragile} weak`,
    );

  return (
    <>
      <section className="mp-dd-pile" aria-labelledby="titre-hypothese">
        <p className="mp-texte-petit">
          <a href={hrefEcranDossier(id, dossierId, "hypotheses")}>
            {t("Toutes les hypothèses", "All hypotheses")}
          </a>
        </p>
        <h3 id="titre-hypothese" className="mp-section__titre">
          {h.libelle}
        </h3>
        <div className="mp-dd-meta">
          <BadgeVerdict etat={etat} />
          <BadgeStatut tonalite="neutre" sansIcone>
            {`${indic} : ${L.VERDICT[h.indication.indication].toLowerCase()}`}
          </BadgeStatut>
        </div>
        {h.critere ? (
          <p className="mp-dd-texte">{`${t("Critère de décision", "Decision criterion")} : ${h.critere}`}</p>
        ) : null}
        {h.description ? <p className="mp-dd-texte mp-texte-doux">{h.description}</p> : null}
        <p className="mp-texte-petit">{libelleRaisonVerdict(h.indication.raison, langue)}</p>
        {h.indication.conflit ? (
          <Alerte
            tonalite="attention"
            titre={t("Conflit entre assertions solides", "Conflict between strong statements")}
            annonce="aucune"
          >
            <p>
              {t(
                "Des assertions solides soutiennent et contredisent l'hypothèse : l'expert arbitre.",
                "Strong statements both support and contradict the hypothesis: the expert arbitrates.",
              )}
            </p>
          </Alerte>
        ) : null}
        <ul
          className="mp-dd-decompte"
          aria-label={t(
            "Décompte des assertions liées par lecture",
            "Count of linked statements by reading",
          )}
        >
          <li>{`${t("Soutiens", "Support")} : ${lecturesTexte(h.indication.soutien)}`}</li>
          <li>{`${t("Contre", "Against")} : ${lecturesTexte(h.indication.contre)}`}</li>
        </ul>
      </section>

      <Carte titre={t("Assertions liées", "Linked statements")} niveauTitre={3}>
        <LiensHypothese
          missionId={id}
          hypotheseId={hypotheseId}
          liens={h.liens}
          assertionsDisponibles={disponibles}
          erreurAssertions={assertions && !assertions.ok ? assertions.message : null}
          peutEcrire={droits.ecrire}
          peutSigner={peutSignerAvisDd(utilisateur.roles)}
        />
      </Carte>

      {droits.ecrire ? (
        <Carte titre={t("Proposer un verdict", "Propose a verdict")} niveauTitre={3}>
          <FormulaireVerdict
            hypotheseId={hypotheseId}
            hypotheseVersion={h.version}
            indication={{ indication: h.indication.indication, raison: h.indication.raison }}
            citables={citables}
            enAttente={h.verdict_en_attente !== null}
          />
        </Carte>
      ) : null}

      <Carte titre={t("Historique des verdicts", "Verdict history")} niveauTitre={3}>
        {!verdicts.ok ? (
          <EtatErreur
            titre={t(
              "L'historique des verdicts n'a pas pu être chargé.",
              "The verdict history could not be loaded.",
            )}
            message={verdicts.message}
            hrefReessayer={hrefHypothese(id, dossierId, hypotheseId)}
          />
        ) : historique.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucun verdict n'a encore été proposé.", "No verdict has been proposed yet.")}
          </p>
        ) : (
          <ol
            className="mp-dd-liste"
            aria-label={t(
              "Verdicts, du plus récent au plus ancien",
              "Verdicts, from newest to oldest",
            )}
          >
            {historique.map((v) => (
              <li key={v.id} className="mp-dd-element">
                <span className="mp-dd-meta">
                  <BadgeStatut
                    tonalite={
                      v.verdict === "confirmee"
                        ? "succes"
                        : v.verdict === "infirmee"
                          ? "danger"
                          : "attention"
                    }
                  >
                    {`${t("Verdict proposé", "Proposed verdict")} : ${L.VERDICT[v.verdict].toLowerCase()}`}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {`${indic} : ${L.VERDICT[v.indication_moteur].toLowerCase()}`}
                  </BadgeStatut>
                  <span className="mp-texte-doux mp-texte-petit">
                    {formaterDateHeure(v.proposee_le, undefined, langue)}
                  </span>
                </span>
                <p className="mp-dd-texte">{v.motif}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    `${v.assertions_citees.length} assertion(s) citée(s)`,
                    `${v.assertions_citees.length} statement(s) cited`,
                  )}
                </p>
                {v.decision ? (
                  <BadgeStatut tonalite={v.decision.decision === "valide" ? "succes" : "danger"}>
                    {v.decision.decision === "valide"
                      ? t("Validé", "Approved")
                      : t("Rejeté", "Rejected")}
                  </BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="attention">
                    {t("En attente de validation", "Pending approval")}
                  </BadgeStatut>
                )}
                {v.decision?.motif ? (
                  <p className="mp-dd-texte">{`${t("Motif", "Reason")} : ${v.decision.motif}`}</p>
                ) : null}
                {!v.decision &&
                droits.valider &&
                peutValiderSansConflit(utilisateur.roles, utilisateur.id, [v.proposee_par]) ? (
                  <ValidationDecision
                    chemin={cheminValidationVerdict(v.id)}
                    objet={t("ce verdict", "this verdict")}
                    succesValide={t("Verdict validé.", "Verdict approved.")}
                    succesRejete={t(
                      "Verdict rejeté : l'état antérieur de l'hypothèse est conservé.",
                      "Verdict rejected: the previous state of the hypothesis is kept.",
                    )}
                  />
                ) : null}
                {!v.decision ? (
                  <MessageAuteurVerdict
                    message={messageAuteurVerdict(
                      utilisateur.roles,
                      utilisateur.id,
                      v.proposee_par,
                      langue,
                    )}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Carte>

      {droits.ecrire && peutRetirer ? (
        <details className="mp-dd-details">
          <summary>{t("Corriger ou retirer l'hypothèse", "Edit or remove the hypothesis")}</summary>
          <div className="mp-dd-details__corps">
            <CorrectionHypothese hypothese={h} />
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Message d'un auteur de verdict qui ne peut pas le valider lui-même ; rien sinon (R-04). */
function MessageAuteurVerdict({ message }: { message: string | null }) {
  return message ? <p className="mp-texte-doux mp-texte-petit">{message}</p> : null;
}
