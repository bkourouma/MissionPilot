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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  LIBELLE_COTATIONS_MASQUEES,
  LIBELLE_COTATIONS_MASQUEES_EN,
  cheminCalibration,
  droitsCalibration,
  hrefCalibration,
  type SessionCalibration,
} from "../../../../../lib/notation-augmentee";
import { nomAuteurGrille } from "../../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Session de calibrage", "Calibration session") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<SessionCalibration>(cheminCalibration(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: "/notation/calibrations",
    libelle: t("Calibration des évaluateurs", "Rater calibration"),
  };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Session de calibrage", "Calibration session")} retour={retour} />
        <EtatErreur
          titre={t("La session n'a pas pu être chargée.", "The session could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefCalibration(id)}
        />
      </div>
    );
  }
  const s = r.donnees;
  const droits = droitsCalibration(utilisateur.roles, s.close, langue);
  const nom = (uid: string | null | undefined) =>
    nomAuteurGrille(uid, utilisateur.id, personnes, langue);
  const mesCotations = new Map(s.mes_cotations.map((c) => [c.cas, c]));
  const avancement = new Map(s.avancement.map((a) => [a.code, a.evaluateurs]));
  const libellesCas = new Map(s.cas.map((c) => [c.code, c.libelle]));
  const restants = s.cas.filter((c) => !mesCotations.has(c.code)).length;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={s.titre}
        retour={retour}
        soustitre={t(
          `Échelle de ${s.niveaux} niveaux · tolérance d'accord de ${s.tolerance} niveau${s.tolerance > 1 ? "x" : ""} · ${s.cas.length} cas`,
          `Scale of ${s.niveaux} levels · agreement tolerance of ${s.tolerance} level${s.tolerance > 1 ? "s" : ""} · ${s.cas.length} cases`,
        )}
        badges={
          <BadgeStatut tonalite={s.close ? "succes" : "attention"}>
            {s.close ? t("Close", "Closed") : t("Ouverte", "Open")}
          </BadgeStatut>
        }
      />

      <Carte titre={t("Informations", "Information")}>
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>{t("Créée", "Created")}</dt>
            <dd>
              {t("le", "on")} {formaterDateHeure(s.cree_le, "Africa/Abidjan", langue)}{" "}
              {t("par", "by")} {nom(s.cree_par)}
            </dd>
          </div>
          {s.close && s.cloturee_le ? (
            <div>
              <dt>{t("Close", "Closed")}</dt>
              <dd>
                {t("le", "on")} {formaterDateHeure(s.cloturee_le, "Africa/Abidjan", langue)}{" "}
                {t("par", "by")} {nom(s.cloturee_par)}
              </dd>
            </div>
          ) : null}
          {s.conclusion ? (
            <div>
              <dt>{t("Conclusion", "Conclusion")}</dt>
              <dd className="mp-na-texte-long">{s.conclusion}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte
        titre={
          s.close ? t("Cas et cotations", "Cases and ratings") : t("Cas à coter", "Cases to rate")
        }
      >
        {!s.close ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {droits.coter
                ? `${t(
                    "Chaque évaluateur cote seul, une fois par cas, sans voir les autres.",
                    "Each rater rates alone, once per case, without seeing the others.",
                  )} ${
                    restants === 0
                      ? t("Vous avez coté tous les cas.", "You have rated all the cases.")
                      : t(
                          `Il vous reste ${restants} cas à coter.`,
                          `You have ${restants} case${restants > 1 ? "s" : ""} left to rate.`,
                        )
                  }`
                : t(
                    "Vous pouvez suivre l'avancement ; votre rôle ne permet pas de coter.",
                    "You can follow progress; your role does not allow rating.",
                  )}{" "}
              {s.cotations === null
                ? langue === "en"
                  ? LIBELLE_COTATIONS_MASQUEES_EN
                  : LIBELLE_COTATIONS_MASQUEES
                : null}
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
        <Carte
          titre={
            s.close
              ? t("Mesure d'écart entre évaluateurs", "Gap measure between raters")
              : t("Mesure d'écart (partielle)", "Gap measure (partial)")
          }
        >
          <VueMesureCalibration mesure={s.mesure} libellesCas={libellesCas} partielle={!s.close} />
        </Carte>
      ) : !s.close ? (
        <Carte titre={t("Mesure d'écart entre évaluateurs", "Gap measure between raters")}>
          <p className="mp-texte-doux">
            {t(
              "La mesure d'écart apparaît à la clôture de la session. Un expert métier qui a coté un cas voit dès maintenant la mesure partielle de ses cas.",
              "The gap measure appears when the session is closed. A business expert who has rated a case sees the partial measure of their cases right away.",
            )}
          </p>
        </Carte>
      ) : null}

      {!s.close ? (
        <Carte titre={t("Clôture par un expert métier", "Close-out by a business expert")}>
          {droits.cloturer ? (
            <CloturerCalibration sessionId={s.id} />
          ) : (
            <Alerte tonalite="info" annonce="aucune">
              <p>
                {droits.explicationCloture ??
                  t(
                    "La clôture revient à un expert métier du cabinet.",
                    "Closing is up to a business expert of the firm.",
                  )}
              </p>
            </Alerte>
          )}
        </Carte>
      ) : null}
    </div>
  );
}
