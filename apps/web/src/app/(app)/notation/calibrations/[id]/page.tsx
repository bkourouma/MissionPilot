import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { CloturerCalibration } from "../../../../../components/notation-augmentee/CloturerCalibration";
import { CotationCas } from "../../../../../components/notation-augmentee/CotationCas";
import { VueMesureCalibration } from "../../../../../components/notation-augmentee/VueMesureCalibration";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  LIBELLE_COTATIONS_MASQUEES,
  cheminCalibration,
  droitsCalibration,
  hrefCalibration,
  type SessionCalibration,
} from "../../../../../lib/notation-augmentee";
import { nomAuteurGrille } from "../../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export const metadata: Metadata = { title: "Session de calibrage" };

/**
 * Une session de calibrage (NOT-13). Double cotation à l'aveugle appliquée par l'API : ce que la
 * page affiche des autres évaluateurs est exactement ce que l'API renvoie (rien avant d'avoir coté
 * un cas, sauf à la clôture). La clôture est réservée à un expert métier (MPN11) ; une session
 * close est figée et sa mesure d'écart est complète.
 */
export default async function PageSessionCalibration({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<SessionCalibration>(cheminCalibration(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/notation/calibrations", libelle: "Calibration des évaluateurs" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Session de calibrage" retour={retour} />
        <EtatErreur
          titre="La session n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefCalibration(id)}
        />
      </div>
    );
  }
  const s = r.donnees;
  const droits = droitsCalibration(utilisateur.roles, s.close);
  const nom = (uid: string | null | undefined) => nomAuteurGrille(uid, utilisateur.id, personnes);
  const mesCotations = new Map(s.mes_cotations.map((c) => [c.cas, c]));
  const avancement = new Map(s.avancement.map((a) => [a.code, a.evaluateurs]));
  const libellesCas = new Map(s.cas.map((c) => [c.code, c.libelle]));
  const restants = s.cas.filter((c) => !mesCotations.has(c.code)).length;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={s.titre}
        retour={retour}
        soustitre={`Échelle de ${s.niveaux} niveaux · tolérance d'accord de ${s.tolerance} niveau${s.tolerance > 1 ? "x" : ""} · ${s.cas.length} cas`}
        badges={
          <BadgeStatut tonalite={s.close ? "succes" : "attention"}>
            {s.close ? "Close" : "Ouverte"}
          </BadgeStatut>
        }
      />

      <Carte titre="Informations">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Créée</dt>
            <dd>
              le {formaterDateHeure(s.cree_le)} par {nom(s.cree_par)}
            </dd>
          </div>
          {s.close && s.cloturee_le ? (
            <div>
              <dt>Close</dt>
              <dd>
                le {formaterDateHeure(s.cloturee_le)} par {nom(s.cloturee_par)}
              </dd>
            </div>
          ) : null}
          {s.conclusion ? (
            <div>
              <dt>Conclusion</dt>
              <dd className="mp-na-texte-long">{s.conclusion}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte titre={s.close ? "Cas et cotations" : "Cas à coter"}>
        {!s.close ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {droits.coter
                ? `Chaque évaluateur cote seul, une fois par cas, sans voir les autres. ${restants === 0 ? "Vous avez coté tous les cas." : `Il vous reste ${restants} cas à coter.`}`
                : "Vous pouvez suivre l'avancement ; votre rôle ne permet pas de coter."}{" "}
              {s.cotations === null ? LIBELLE_COTATIONS_MASQUEES : null}
            </p>
          </Alerte>
        ) : null}
        <ol className="mp-na-liste">
          {s.cas.map((c) => (
            <CotationCas
              key={c.code}
              sessionId={s.id}
              cas={c}
              niveaux={s.niveaux}
              evaluateurs={avancement.get(c.code) ?? 0}
              maCotation={mesCotations.get(c.code) ?? null}
              visibles={(s.cotations ?? []).filter((x) => x.cas === c.code)}
              utilisateurId={utilisateur.id}
              peutCoter={droits.coter}
              close={s.close}
            />
          ))}
        </ol>
      </Carte>

      {s.mesure ? (
        <Carte titre={s.close ? "Mesure d'écart entre évaluateurs" : "Mesure d'écart (partielle)"}>
          <VueMesureCalibration mesure={s.mesure} libellesCas={libellesCas} partielle={!s.close} />
        </Carte>
      ) : !s.close ? (
        <Carte titre="Mesure d'écart entre évaluateurs">
          <p className="mp-texte-doux">
            La mesure d&apos;écart apparaît à la clôture de la session. Un expert métier qui a coté
            un cas voit dès maintenant la mesure partielle de ses cas.
          </p>
        </Carte>
      ) : null}

      {!s.close ? (
        <Carte titre="Clôture par un expert métier">
          {droits.cloturer ? (
            <CloturerCalibration sessionId={s.id} />
          ) : (
            <Alerte tonalite="info" annonce="aucune">
              <p>
                {droits.explicationCloture ?? "La clôture revient à un expert métier du cabinet."}
              </p>
            </Alerte>
          )}
        </Carte>
      ) : null}
    </div>
  );
}
