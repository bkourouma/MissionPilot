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
  peutSignerAvisDd,
  messageAuteurVerdict,
  peutValiderSansConflit,
  SENS_LIEN_DD_LIBELLES,
  VERDICT_DD_LIBELLES,
  type ReponseHypotheses,
  type VerdictDetail,
} from "../../../../../../../../lib/due-diligence";
import { chargerAssertionsMission } from "../../../../../../../../lib/due-diligence-serveur";
import { formaterDateHeure } from "../../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../../lib/session";

export const metadata: Metadata = { title: "Hypothèse" };

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
        titre="L'hypothèse n'a pas pu être chargée."
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
    libelle: `${l.enonce.length > 110 ? `${l.enonce.slice(0, 109)}…` : l.enonce} (${SENS_LIEN_DD_LIBELLES[l.sens].toLowerCase()})`,
  }));
  const historique = verdicts.ok
    ? [...verdicts.donnees.elements].sort((a, b) => Number(b.numero) - Number(a.numero))
    : [];
  const peutRetirer = h.verdict_en_attente === null;

  return (
    <>
      <section className="mp-dd-pile" aria-labelledby="titre-hypothese">
        <p className="mp-texte-petit">
          <a href={hrefEcranDossier(id, dossierId, "hypotheses")}>Toutes les hypothèses</a>
        </p>
        <h3 id="titre-hypothese" className="mp-section__titre">
          {h.libelle}
        </h3>
        <div className="mp-dd-meta">
          <BadgeVerdict etat={etat} />
          <BadgeStatut tonalite="neutre" sansIcone>
            {`Indication du moteur : ${VERDICT_DD_LIBELLES[h.indication.indication].toLowerCase()}`}
          </BadgeStatut>
        </div>
        {h.critere ? <p className="mp-dd-texte">{`Critère de décision : ${h.critere}`}</p> : null}
        {h.description ? <p className="mp-dd-texte mp-texte-doux">{h.description}</p> : null}
        <p className="mp-texte-petit">{libelleRaisonVerdict(h.indication.raison)}</p>
        {h.indication.conflit ? (
          <Alerte tonalite="attention" titre="Conflit entre assertions solides" annonce="aucune">
            <p>
              Des assertions solides soutiennent et contredisent l&apos;hypothèse : l&apos;expert
              arbitre.
            </p>
          </Alerte>
        ) : null}
        <ul className="mp-dd-decompte" aria-label="Décompte des assertions liées par lecture">
          <li>{`Soutiens : ${h.indication.soutien.solide} solide(s), ${h.indication.soutien.etayee} étayé(s), ${h.indication.soutien.fragile} fragile(s)`}</li>
          <li>{`Contre : ${h.indication.contre.solide} solide(s), ${h.indication.contre.etayee} étayé(s), ${h.indication.contre.fragile} fragile(s)`}</li>
        </ul>
      </section>

      <Carte titre="Assertions liées" niveauTitre={3}>
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
        <Carte titre="Proposer un verdict" niveauTitre={3}>
          <FormulaireVerdict
            hypotheseId={hypotheseId}
            hypotheseVersion={h.version}
            indication={{ indication: h.indication.indication, raison: h.indication.raison }}
            citables={citables}
            enAttente={h.verdict_en_attente !== null}
          />
        </Carte>
      ) : null}

      <Carte titre="Historique des verdicts" niveauTitre={3}>
        {!verdicts.ok ? (
          <EtatErreur
            titre="L'historique des verdicts n'a pas pu être chargé."
            message={verdicts.message}
            hrefReessayer={hrefHypothese(id, dossierId, hypotheseId)}
          />
        ) : historique.length === 0 ? (
          <p className="mp-texte-doux">Aucun verdict n&apos;a encore été proposé.</p>
        ) : (
          <ol className="mp-dd-liste" aria-label="Verdicts, du plus récent au plus ancien">
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
                    {`Verdict proposé : ${VERDICT_DD_LIBELLES[v.verdict].toLowerCase()}`}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {`Indication du moteur : ${VERDICT_DD_LIBELLES[v.indication_moteur].toLowerCase()}`}
                  </BadgeStatut>
                  <span className="mp-texte-doux mp-texte-petit">
                    {formaterDateHeure(v.proposee_le)}
                  </span>
                </span>
                <p className="mp-dd-texte">{v.motif}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {`${v.assertions_citees.length} assertion(s) citée(s)`}
                </p>
                {v.decision ? (
                  <BadgeStatut tonalite={v.decision.decision === "valide" ? "succes" : "danger"}>
                    {v.decision.decision === "valide" ? "Validé" : "Rejeté"}
                  </BadgeStatut>
                ) : (
                  <BadgeStatut tonalite="attention">En attente de validation</BadgeStatut>
                )}
                {v.decision?.motif ? (
                  <p className="mp-dd-texte">{`Motif : ${v.decision.motif}`}</p>
                ) : null}
                {!v.decision &&
                droits.valider &&
                peutValiderSansConflit(utilisateur.roles, utilisateur.id, [v.proposee_par]) ? (
                  <ValidationDecision
                    chemin={cheminValidationVerdict(v.id)}
                    objet="ce verdict"
                    succesValide="Verdict validé."
                    succesRejete="Verdict rejeté : l'état antérieur de l'hypothèse est conservé."
                  />
                ) : null}
                {!v.decision ? (
                  <MessageAuteurVerdict
                    message={messageAuteurVerdict(
                      utilisateur.roles,
                      utilisateur.id,
                      v.proposee_par,
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
          <summary>Corriger ou retirer l&apos;hypothèse</summary>
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
