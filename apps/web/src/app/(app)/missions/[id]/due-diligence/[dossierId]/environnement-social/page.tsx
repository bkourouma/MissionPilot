import type { Metadata } from "next";
import { BadgeNiveauEs } from "../../../../../../../components/due-diligence/BadgesDd";
import { DecisionExclusion } from "../../../../../../../components/due-diligence/DecisionExclusion";
import { FormulaireFiltrage } from "../../../../../../../components/due-diligence/FormulaireFiltrage";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  CRITERE_TOUCHE_LIBELLES,
  cheminFiltrages,
  DECISION_EXCLUSION_LIBELLES,
  droitsDd,
  hrefEcranDossier,
  libelleTheme,
  peutValiderSansConflit,
  phraseExclusionsAnterieures,
  type ReponseFiltrages,
} from "../../../../../../../lib/due-diligence";
import {
  chargerDossier,
  chargerListesExclusion,
  chargerTaxonomies,
} from "../../../../../../../lib/due-diligence-serveur";
import { formaterDateHeure } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Environnement et social" };

/**
 * Filtrage environnemental et social (DD-14) : règles d'exclusion touchées par les activités
 * déclarées, décisions motivées d'un valideur (exclusion confirmée ou faux positif écarté) et
 * synthèse des huit thèmes. La dernière revue fait foi ; la synthèse est recalculée à chaque lecture.
 */
export default async function PageEnvironnementSocialDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const { utilisateur } = await exigerPermission("dd.lire");
  const [mission, dossier] = await Promise.all([chargerMission(id), chargerDossier(dossierId)]);
  if (!mission.ok || !dossier.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseFiltrages>(cheminFiltrages(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La revue environnementale et sociale n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "environnement-social")}
      />
    );
  }
  const [listes, taxonomies] = droits.ecrire
    ? await Promise.all([chargerListesExclusion(), chargerTaxonomies()])
    : [null, null];
  const dernier = [...r.donnees.elements].sort((a, b) => b.numero - a.numero)[0] ?? null;
  const s = r.donnees.synthese;
  const anterieures = r.donnees.exclusions_anterieures_non_levees;
  const phraseAnterieures = phraseExclusionsAnterieures(anterieures.length);

  return (
    <>
      <p className="mp-texte-doux">
        Référence : normes de performance de la SFI (cadre public) ; les libellés sont ceux de
        MissionPilot et restent à valider par un expert E&amp;S.
      </p>

      {dernier === null || s === null ? (
        <p className="mp-texte-doux" role="status">
          Aucune revue n&apos;a encore été réalisée pour ce dossier.
        </p>
      ) : (
        <>
          <Carte titre="Synthèse de la dernière revue" niveauTitre={3}>
            <div className="mp-dd-pile">
              <span className="mp-dd-meta">
                <BadgeNiveauEs niveau={s.niveau_global} />
                <BadgeStatut tonalite={s.bloquant ? "danger" : "succes"}>
                  {s.bloquant ? "Bloquant : exclusion non levée" : "Aucune exclusion bloquante"}
                </BadgeStatut>
                <span className="mp-texte-doux mp-texte-petit">
                  {formaterDateHeure(dernier.cree_le)}
                </span>
              </span>
              {!s.complet ? (
                <Alerte tonalite="attention" titre="Revue incomplète" annonce="aucune">
                  <p>
                    {`Thèmes non évalués : ${s.manquants.map(libelleTheme).join(", ") || "aucun"}.`}
                  </p>
                </Alerte>
              ) : null}
              {s.a_documenter.length > 0 ? (
                <p className="mp-texte-petit">
                  {`Thèmes à documenter (niveau élevé ou critique, source absente ou fragile) : ${s.a_documenter.map(libelleTheme).join(", ")}.`}
                </p>
              ) : null}
              <ul className="mp-dd-liste" aria-label="Niveau par thème">
                {dernier.themes.map((t) => (
                  <li key={t.code} className="mp-dd-element">
                    <span className="mp-dd-meta">
                      <strong>{libelleTheme(t.code)}</strong>
                      <BadgeNiveauEs niveau={t.niveau} />
                    </span>
                    {t.justification ? <p className="mp-dd-texte">{t.justification}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          </Carte>

          {phraseAnterieures !== null && dernier !== null ? (
            <Carte titre="Exclusions antérieures non levées" niveauTitre={3}>
              <div className="mp-dd-pile">
                <Alerte tonalite="danger" titre="Exclusion toujours bloquante" annonce="aucune">
                  <p>{phraseAnterieures}</p>
                </Alerte>
                <p className="mp-texte-petit mp-texte-doux">
                  Une nouvelle revue dont les activités ne touchent plus la règle ne la lève pas :
                  un valideur autre que l&apos;auteur de la dernière revue doit écarter la règle.
                </p>
                <ul className="mp-dd-liste" aria-label="Exclusions antérieures non levées">
                  {anterieures.map((a) => (
                    <li key={a.regle} className="mp-dd-element">
                      <p className="mp-dd-element__titre">{a.libelle}</p>
                      <BadgeStatut tonalite="danger">
                        Confirmée lors d&apos;une revue antérieure
                      </BadgeStatut>
                      {droits.valider &&
                      peutValiderSansConflit(utilisateur.roles, utilisateur.id, [
                        dernier.auteur_id,
                      ]) ? (
                        <DecisionExclusion
                          filtrageId={dernier.id}
                          regleCode={a.regle}
                          libelleRegle={a.libelle}
                        />
                      ) : droits.valider ? (
                        <p className="mp-texte-doux mp-texte-petit">
                          Vous avez lancé la dernière revue : une autre personne doit décider.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </Carte>
          ) : null}

          <Carte titre="Règles d'exclusion touchées" niveauTitre={3}>
            {dernier.touches.length === 0 ? (
              <p className="mp-texte-doux">
                {`Aucune règle n'est touchée (${dernier.non_touchees} règle(s) vérifiée(s)).`}
              </p>
            ) : (
              <ul className="mp-dd-liste" aria-label="Règles touchées">
                {dernier.touches.map((t) => (
                  <li key={t.regle} className="mp-dd-element">
                    <p className="mp-dd-element__titre">{t.libelle}</p>
                    <p className="mp-texte-petit">
                      {`Critères touchés : ${t.criteres.map((c) => CRITERE_TOUCHE_LIBELLES[c]).join(", ")}`}
                      {t.mots_trouves.length > 0
                        ? ` · mots trouvés : ${t.mots_trouves.join(", ")}`
                        : ""}
                    </p>
                    <p className="mp-texte-petit mp-texte-doux">
                      Un mot-clé correspond aussi à ses dérivés : un faux positif est possible, à
                      trancher par un valideur.
                    </p>
                    {t.decision ? (
                      <BadgeStatut tonalite={t.decision === "confirmee" ? "danger" : "succes"}>
                        {DECISION_EXCLUSION_LIBELLES[t.decision]}
                      </BadgeStatut>
                    ) : (
                      <BadgeStatut tonalite="attention">Sans décision : bloquant</BadgeStatut>
                    )}
                    {droits.valider &&
                    peutValiderSansConflit(utilisateur.roles, utilisateur.id, [
                      dernier.auteur_id,
                    ]) ? (
                      <DecisionExclusion
                        filtrageId={dernier.id}
                        regleCode={t.regle}
                        libelleRegle={t.libelle}
                      />
                    ) : droits.valider ? (
                      <p className="mp-texte-doux mp-texte-petit">
                        Vous avez lancé cette revue : une autre personne doit décider.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        </>
      )}

      {droits.ecrire && listes && taxonomies ? (
        <Carte titre={dernier ? "Nouvelle revue" : "Première revue"} niveauTitre={3}>
          {taxonomies.erreur ? (
            <Alerte tonalite="attention" titre="Listes de choix incomplètes" annonce="aucune">
              <p>{taxonomies.erreur}</p>
            </Alerte>
          ) : null}
          <FormulaireFiltrage
            dossierId={dossierId}
            listes={listes.ok ? listes.donnees : []}
            erreurListes={listes.ok ? null : listes.message}
            secteurs={taxonomies.secteurs}
            pays={taxonomies.pays}
            dernier={dernier}
            parDefaut={{
              secteur_code: dossier.donnees.secteur_code,
              pays_code: dossier.donnees.pays_code,
            }}
          />
        </Carte>
      ) : null}
    </>
  );
}
